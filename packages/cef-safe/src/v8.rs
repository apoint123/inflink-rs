use crate::base::CefRefPtr;
use crate::error::{CefError, CefResult};
use crate::string::{CefString16, string_from_cef_userfree};
use cef_sys::_cef_v8exception_t;
use std::ptr;

pub type CefV8Value = CefRefPtr<cef_sys::_cef_v8value_t>;
pub type CefV8Context = CefRefPtr<cef_sys::_cef_v8context_t>;

impl CefV8Context {
    /// 获取当前 V8 的上下文
    #[must_use = "不使用它的返回值你调用它干嘛?"]
    pub fn current() -> CefResult<Self> {
        unsafe { Self::from_raw(cef_sys::cef_v8context_get_current_context()) }
    }
}

impl CefV8Value {
    /// 从`&str` 创建一个新的 JavaScript 字符串值
    ///
    /// # Errors
    ///
    /// 如果 CEF 内部无法创建字符串对象，将返回错误
    #[must_use = "不使用它的返回值你调用它干嘛?"]
    pub fn try_from_str(s: &str) -> CefResult<Self> {
        let cef_str = CefString16::from_str(s)?;
        let raw_ptr = unsafe { cef_sys::cef_v8value_create_string(&raw const *cef_str) };
        unsafe { Self::from_raw(raw_ptr) }
    }

    /// 执行JS函数并返回其结果或错误
    #[must_use = "不处理这个Result, 你就无法知道JS端是否执行成功, 可能会错过一个关键的错误"]
    pub fn execute_function(&self, this: Option<&Self>, args: Vec<Self>) -> CefResult<Self> {
        let this_ptr = this.map_or(ptr::null_mut(), Self::as_raw);

        // 这里必须使用 into_raw 而不是 as_row
        // 经过反复测试，网易云提供的 execute_function 似乎在内部帮我们调用了 release，
        // 错误地取得了所有权，在这里调用 as_row，会造成双重释放并导致网易云音乐崩溃
        // 这很不同寻常，但千万不要改成 as_row，它真的会崩溃！
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

        // --- 异常处理路径 ---
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
