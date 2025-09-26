use crate::base::CefRefPtr;
use crate::string::CefString16;
use cef_sys;

pub type CefV8Value = CefRefPtr<cef_sys::_cef_v8value_t>;
pub type CefV8Context = CefRefPtr<cef_sys::_cef_v8context_t>;

impl CefV8Context {
    #[must_use]
    pub fn current() -> Option<Self> {
        unsafe { Self::from_raw(cef_sys::cef_v8context_get_current_context()) }
    }
}

impl CefV8Value {
    #[must_use]
    pub fn try_from_str(s: &str) -> Option<Self> {
        let cef_str = CefString16::from_str(s);
        let raw_ptr = unsafe { cef_sys::cef_v8value_create_string(&raw const *cef_str) };
        unsafe { Self::from_raw(raw_ptr) }
    }

    #[must_use]
    pub fn execute_function(&self, this: Option<&Self>, args: Vec<Self>) -> Option<Self> {
        let this_ptr = this.map_or(std::ptr::null_mut(), Self::as_raw);

        let args_vec: Vec<*mut cef_sys::_cef_v8value_t> =
            args.into_iter().map(Self::into_raw).collect();

        let raw_ptr = unsafe {
            self.execute_function.map_or(std::ptr::null_mut(), |func| {
                func(self.as_raw(), this_ptr, args_vec.len(), args_vec.as_ptr())
            })
        };

        unsafe { Self::from_raw(raw_ptr) }
    }
}
