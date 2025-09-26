use std::fmt::{Debug, Display};

use crate::sys;

#[repr(C)]
pub struct CefString(*mut sys::cef_string_t);

impl CefString {
    pub unsafe fn from_raw(raw: *mut sys::cef_string_t) -> Self {
        Self(raw as _)
    }
    pub unsafe fn as_raw(&self) -> *mut sys::cef_string_t {
        self.0
    }
    pub unsafe fn to_raw(self) -> *mut sys::cef_string_t {
        self.0
    }
}

impl Debug for CefString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CefString")
            .field("addr", &format!("0x{:08X}", self.0 as usize))
            .field("str", &format!("{:?}", self.to_string()))
            .finish()
    }
}

impl Clone for CefString {
    fn clone(&self) -> Self {
        unsafe {
            let s = *self.0;
            let s = Box::new(::core::slice::from_raw_parts(s.str_, s.length).to_vec()).leak();
            let result = Box::leak(Box::new(sys::cef_string_t {
                str_: s.as_mut_ptr(),
                length: s.len(),
                dtor: None,
            }));
            CefString(result as *mut _)
        }
    }
}

impl Default for CefString {
    fn default() -> Self {
        unsafe { std::mem::zeroed() }
    }
}

impl Display for CefString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = unsafe {
            if let Some(data) = self.0.as_ref() {
                if data.str_.is_null() {
                    "".into()
                } else {
                    String::from_utf16_lossy(::core::slice::from_raw_parts(data.str_, data.length))
                }
            } else {
                "".into()
            }
        };
        f.write_str(&str)
    }
}

impl From<CefString> for String {
    fn from(data: CefString) -> Self {
        unsafe {
            if let Some(data) = data.0.as_ref() {
                if data.str_.is_null() {
                    "".into()
                } else {
                    String::from_utf16_lossy(::core::slice::from_raw_parts(data.str_, data.length))
                }
            } else {
                "".into()
            }
        }
    }
}

impl From<&str> for CefString {
    fn from(data: &str) -> Self {
        unsafe {
            let result: &mut sys::cef_string_t = Box::leak(Box::new(::core::mem::zeroed()));

            let data = data.encode_utf16().chain(Some(0)).collect::<Vec<_>>();

            assert_ne!(
                sys::cef_string_utf16_set(data.as_ptr(), data.len() - 1, result, 1),
                0
            );

            Self::from_raw(result as *mut _ as _)
        }
    }
}

impl From<String> for CefString {
    fn from(value: String) -> Self {
        value.as_str().into()
    }
}
