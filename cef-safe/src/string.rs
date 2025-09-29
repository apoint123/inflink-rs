use crate::error::{CefError, CefResult};
use cef_sys::{cef_string_t, cef_string_userfree_utf16_free, cef_string_utf16_set};
use std::ops::Deref;

pub struct CefString16 {
    cef_string: cef_string_t,
}

impl CefString16 {
    /// 从 Rust 字符串切片 (`&str`) 创建一个新的 `CefString16` 实例
    ///
    /// # Errors
    ///
    /// 如果底层的 `cef_string_utf16_set` 调用失败，返回 `CefError::StringConversionFailed`
    #[must_use = "不使用它的返回值你调用它干嘛?"]
    pub fn from_str(s: &str) -> CefResult<Self> {
        let utf16_data: Vec<u16> = s.encode_utf16().collect();
        let utf16_len = utf16_data.len();
        let mut cef_string = cef_string_t {
            str_: std::ptr::null_mut(),
            length: 0,
            dtor: None,
        };

        let success = unsafe {
            cef_string_utf16_set(utf16_data.as_ptr(), utf16_len, &raw mut cef_string, 1) == 1
        };

        if success {
            Ok(Self { cef_string })
        } else {
            Err(CefError::StringConversionFailed)
        }
    }
}

impl TryFrom<&str> for CefString16 {
    type Error = CefError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        Self::from_str(s)
    }
}

impl Drop for CefString16 {
    fn drop(&mut self) {
        unsafe {
            if let Some(dtor) = self.cef_string.dtor {
                dtor(self.cef_string.str_);
            }
        }
    }
}

impl Deref for CefString16 {
    type Target = cef_string_t;

    /// 解引用 `CefString16` 以获得 `&cef_string_t`
    fn deref(&self) -> &Self::Target {
        &self.cef_string
    }
}

/// 从一个 CEF userfree 字符串 (`*mut cef_string_t`) 创建一个 `String`
///
/// 这个函数会消耗掉 CEF 字符串并释放内存
///
/// # Safety
///
/// 必须保证 `cef_str` 是一个需要释放的有效指针，或者是一个 `null` 指针
pub unsafe fn string_from_cef_userfree(cef_str: *mut cef_string_t) -> String {
    struct CefUserFreeGuard(*mut cef_string_t);
    impl Drop for CefUserFreeGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    cef_string_userfree_utf16_free(self.0);
                }
            }
        }
    }

    if cef_str.is_null() {
        return String::new();
    }

    let guard = CefUserFreeGuard(cef_str);

    // Safety: 调用者保证指针是有效的
    unsafe { string_from_cef(&*guard.0) }
}

/// 从一个 `&cef_string_t` 引用创建一个 Rust `String`，不释放内存
///
/// # Safety
///
/// 必须保证 `s` 指向一个有效的 `cef_string_t` 结构体，并且其
/// `str_` 字段和 `length` 字段是有效的
pub unsafe fn string_from_cef(s: &cef_string_t) -> String {
    if s.str_.is_null() || s.length == 0 {
        return String::new();
    }

    // Safety: 调用者保证指针是有效的
    let slice = unsafe { std::slice::from_raw_parts(s.str_, s.length) };
    String::from_utf16_lossy(slice)
}
