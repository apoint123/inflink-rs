//! 原生 API 的公共支撑：panic 兜底与返回值缓冲区。

use std::{
    ffi::{
        CStr,
        CString,
        c_char,
    },
    panic,
    ptr,
    sync::{
        LazyLock,
        Mutex,
    },
};

use tracing::error;

/// 把 betterncm 传进来的 C 字符串转成 `String`, 空指针返回空串
pub fn c_char_to_string(s: *const c_char) -> String {
    if s.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(s).to_string_lossy().into_owned() }
}

/// 在 FFI 边界内执行 `func`, 捕获其中的 panic 并返回 `T::default()`
///
/// `extern "C"` 函数不允许 unwind 穿过边界, 未捕获的 panic 会直接终止进程,
/// 因此所有暴露给 betterncm 的入口都应该用它包一层。
pub fn safe_call<F, T>(func: F) -> T
where
    F: FnOnce() -> T + panic::UnwindSafe,
    T: Default,
{
    match panic::catch_unwind(func) {
        Ok(result) => result,
        Err(e) => {
            let message = e.downcast_ref::<&'static str>().map_or_else(
                || {
                    e.downcast_ref::<String>()
                        .map_or("未知类型的 Panic", |s| s.as_str())
                },
                |s| *s,
            );
            error!("一个 FFI 调用发生了 Panic: {message}");
            T::default()
        }
    }
}

/// 用来存放返回值的缓冲区
///
/// betterncm 复制完我们的返回值后就直接丢弃了，完全没有释放内存，所以我们在 `dispatch`
/// 直接返回一个缓冲区
///
/// 如果 betterncm 未来更新了他们的代码，又尝试保留之前的指针，这里需要修正
///
/// 参见 <https://github.com/std-microblock/chromatic/blob/1b7eb7fdaa08de15e579c86dadb6ef848a72b6f1/src/v8NativeCalls.cpp#L585-L590>
static RETURN_BUFFER: LazyLock<Mutex<CString>> = LazyLock::new(|| Mutex::new(CString::default()));

/// 把 `value` 放进返回缓冲区, 并返回指向它的指针, 供 betterncm 读取
///
/// 返回的指针只在本次调用返回后、betterncm 读取它之前有效。由于 betterncm 会在我们的
/// 函数返回后立刻把它复制成 V8 字符串, 中间不存在重新进入原生 API 的机会, 因此所有
/// 原生 API 共用这一个缓冲区是安全的。
pub fn return_string(value: String) -> *mut c_char {
    let mut guard = match RETURN_BUFFER.lock() {
        Ok(guard) => guard,
        Err(e) => {
            error!("RETURN_BUFFER 锁毒化: {e}");
            return ptr::null_mut();
        }
    };

    *guard = match CString::new(value) {
        Ok(cstring) => cstring,
        Err(e) => {
            error!("无法创建返回的 CString: {e}");
            CString::default()
        }
    };

    guard.as_ptr().cast_mut()
}
