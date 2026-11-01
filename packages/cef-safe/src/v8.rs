use std::ptr;

use cef_sys::_cef_v8exception_t;

use crate::{
    base::CefRefPtr,
    error::{
        CefError,
        CefResult,
    },
    string::{
        CefString16,
        string_from_cef_userfree,
    },
};

pub type CefV8Value = CefRefPtr<cef_sys::_cef_v8value_t>;
pub type CefV8Context = CefRefPtr<cef_sys::_cef_v8context_t>;

impl CefV8Context {
    /// 检查该 V8 上下文是否仍然有效
    #[must_use]
    pub fn is_valid(&self) -> bool {
        unsafe { self.is_valid.is_some_and(|func| func(self.as_raw()) == 1) }
    }

    /// 获取当前 V8 的上下文
    pub fn current() -> CefResult<Self> {
        unsafe { Self::from_raw(cef_sys::cef_v8context_get_current_context()) }
    }
}

impl CefV8Value {
    /// 检查该 V8 上下文是否仍然有效
    #[must_use]
    pub fn is_valid(&self) -> bool {
        unsafe { self.is_valid.is_some_and(|func| func(self.as_raw()) == 1) }
    }

    /// 冻结/切断 `ArrayBuffer` 的底层内存块，防止 JS 继续访问
    ///
    /// 对于用 `cef_v8value_create_array_buffer` 创建的外部化 `ArrayBuffer`，
    /// CEF 文档保证这一步会触发释放回调，因此它是确定性回收缓冲区的关键一步。
    #[must_use]
    pub fn neuter_array_buffer(&self) -> bool {
        unsafe {
            self.neuter_array_buffer
                .is_some_and(|func| func(self.as_raw()) == 1)
        }
    }

    /// 从`&str` 创建一个新的 JavaScript 字符串值
    ///
    /// # Errors
    ///
    /// 如果 CEF 内部无法创建字符串对象，将返回错误
    pub fn try_from_str(s: &str) -> CefResult<Self> {
        let cef_str = CefString16::from_str(s)?;
        let raw_ptr = unsafe { cef_sys::cef_v8value_create_string(&raw const *cef_str) };
        unsafe { Self::from_raw(raw_ptr) }
    }

    /// 执行JS函数并返回其结果或错误
    ///
    /// CEF C API 的 refptr 参数遵循**所有权转移**约定：libcef 侧的
    /// `CppToC::Unwrap` 会先给底层对象加一份引用，再释放调用方传入的那一份 wrapper
    /// 引用（源码注释："the reference that was added before the structure was passed
    /// back to us"）。官方 C++ 包装库会在传参前由 `CtoCpp::Unwrap` 补上这一份，所以
    /// C++ 用户感知不到；这里是直接调用 C API，必须自己交出。
    ///
    /// 相关源码（CEF 91，公开分支 4472，commit `04c8d56`）：
    ///
    /// - `execute_function` 胶水层，参数与 `object` 都会经过 `CppToC::Unwrap`： <https://github.com/chromiumembedded/cef/blob/04c8d5653ca5b3e36b693d871cce1ef09617bfc9/libcef_dll/cpptoc/v8value_cpptoc.cc#L909-L941>
    /// - `CppToC::Unwrap`，消费引用的位置： <https://github.com/chromiumembedded/cef/blob/04c8d5653ca5b3e36b693d871cce1ef09617bfc9/libcef_dll/cpptoc/cpptoc_ref_counted.h#L39-L58>
    /// - `CtoCpp::Unwrap`，C++ 包装库的补偿： <https://github.com/chromiumembedded/cef/blob/04c8d5653ca5b3e36b693d871cce1ef09617bfc9/libcef_dll/ctocpp/ctocpp_ref_counted.h#L131-L149>
    ///
    /// `args` 按值传入，**调用后即被消费**，不能再使用；`this` 是借用，内部会克隆
    /// 一份再交出，调用方手里的引用不受影响。
    ///
    /// 若误用 `as_raw` 借出引用，接收方仍会消费掉它，调用返回后 Rust 侧再析构就是
    /// use-after-free / 双重释放。
    pub fn execute_function(&self, this: Option<&Self>, args: Vec<Self>) -> CefResult<Self> {
        // this 是借用，不能把调用方唯一的一份引用交出去；克隆一份再 into_raw，
        // 等价于官方 C++ 包装库在传参前对 object 做的 UnderlyingAddRef()。
        let this_ptr = this.map_or(ptr::null_mut(), |value| value.clone().into_raw());

        // CEF 会消费每个参数携带的一份引用，因此这里必须交出所有权（into_raw）而不是
        // 借出（as_raw）。改用 as_raw 会在调用返回后双重释放并导致崩溃。
        let args_vec: Vec<*mut cef_sys::_cef_v8value_t> =
            args.into_iter().map(Self::into_raw).collect();

        let raw_retval = unsafe {
            self.execute_function.map_or(ptr::null_mut(), |func| {
                func(self.as_raw(), this_ptr, args_vec.len(), args_vec.as_ptr())
            })
        };

        if !raw_retval.is_null() {
            return unsafe { Self::from_raw(raw_retval) };
        }

        let has_exception =
            unsafe { self.has_exception.map_or(0, |func| func(self.as_raw())) == 1 };

        if has_exception {
            let exception_ptr = unsafe {
                self.get_exception
                    .map_or(ptr::null_mut(), |func| func(self.as_raw()))
            };

            let error = unsafe { error_from_exception_ptr(exception_ptr) };

            unsafe {
                if let Some(func) = self.clear_exception {
                    func(self.as_raw());
                }
            }

            Err(error)
        } else {
            Err(CefError::V8FunctionExecutionFailed)
        }
    }
}

pub type CefV8Exception = CefRefPtr<cef_sys::_cef_v8exception_t>;

/// 从 `CefV8Exception` 指针中提取错误信息并转换为 `CefError`。
///
/// 此函数会消耗掉 `exception_ptr`
unsafe fn error_from_exception_ptr(exception_ptr: *mut _cef_v8exception_t) -> CefError {
    let Ok(exception) = (unsafe { CefV8Exception::from_raw(exception_ptr) }) else {
        return CefError::V8FunctionExecutionFailed;
    };

    let message = exception.get_message.map_or_else(String::new, |f| unsafe {
        string_from_cef_userfree(f(exception.as_raw()))
    });
    let script = exception
        .get_script_resource_name
        .map_or_else(String::new, |f| unsafe {
            string_from_cef_userfree(f(exception.as_raw()))
        });
    let line = exception
        .get_line_number
        .map_or(0, |f| unsafe { f(exception.as_raw()) });
    let column = exception
        .get_start_column
        .map_or(0, |f| unsafe { f(exception.as_raw()) });

    CefError::V8Exception {
        message,
        script,
        line,
        column,
    }
}
