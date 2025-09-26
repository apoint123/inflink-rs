use std::ops::Deref;

use cef_sys::{cef_string_t, cef_string_utf16_set};

pub struct CefString16 {
    pub cef_string: cef_string_t,
    #[allow(dead_code)]
    utf16_data: Vec<u16>,
}

impl CefString16 {
    pub fn from_str(s: &str) -> Self {
        let utf16_data: Vec<u16> = s.encode_utf16().collect();

        let utf16_len = utf16_data.len();

        let mut cef_string = cef_string_t {
            str_: std::ptr::null_mut(),
            length: 0,
            dtor: None,
        };

        unsafe {
            cef_string_utf16_set(utf16_data.as_ptr(), utf16_len, &raw mut cef_string, 0);
        }

        Self {
            cef_string,
            utf16_data,
        }
    }
}

impl Deref for CefString16 {
    type Target = cef_string_t;

    fn deref(&self) -> &Self::Target {
        &self.cef_string
    }
}
