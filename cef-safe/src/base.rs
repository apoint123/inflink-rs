use cef_sys;
use std::marker::PhantomData;
use std::ops::Deref;
use std::ptr::NonNull;

pub unsafe trait CefStruct {
    type CefType;
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t;
}

unsafe impl CefStruct for cef_sys::_cef_v8value_t {
    type CefType = Self;
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        (&raw const self.base).cast_mut()
    }
}

unsafe impl CefStruct for cef_sys::_cef_v8context_t {
    type CefType = Self;
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        (&raw const self.base).cast_mut()
    }
}

#[repr(transparent)]
pub struct CefRefPtr<T: CefStruct> {
    ptr: NonNull<T>,
    /// 标记，用来防止意外发送到其它线程
    _phantom: PhantomData<*mut T>,
}

impl<T: CefStruct> CefRefPtr<T> {
    pub unsafe fn from_raw(ptr: *mut T) -> Option<Self> {
        NonNull::new(ptr).map(|ptr| Self {
            ptr,
            _phantom: PhantomData,
        })
    }

    #[must_use]
    pub const fn as_raw(&self) -> *mut T {
        self.ptr.as_ptr()
    }

    #[must_use = "不使用返回的指针可能会导致内存泄漏"]
    pub const fn into_raw(self) -> *mut T {
        let ptr = self.ptr.as_ptr();
        std::mem::forget(self);
        ptr
    }
}

impl<T: CefStruct> Clone for CefRefPtr<T> {
    fn clone(&self) -> Self {
        unsafe {
            let base = self.get_base();
            if let Some(add_ref) = (*base).add_ref {
                add_ref(base);
            }
        }
        Self {
            ptr: self.ptr,
            _phantom: PhantomData,
        }
    }
}

impl<T: CefStruct> Drop for CefRefPtr<T> {
    fn drop(&mut self) {
        unsafe {
            let base = self.get_base();
            if let Some(release) = (*base).release {
                release(base);
            }
        }
    }
}

impl<T: CefStruct> Deref for CefRefPtr<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe { self.ptr.as_ref() }
    }
}

impl<T: CefStruct> CefRefPtr<T> {
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        unsafe { self.ptr.as_ref().get_base() }
    }
}
