use crate::error::{CefError, CefResult};
use cef_sys;
use std::marker::PhantomData;
use std::ops::Deref;
use std::ptr::NonNull;

/// 一个 `unsafe trait`，用于抽象所有 CEF 的引用计数结构体
///
/// # Safety
///
/// 实现此 trait 的类型必须保证它在内存布局上与一个以 `_cef_base_ref_counted_t`
/// 为首成员的 CEF 结构体兼容。`get_base` 方法的实现必须返回一个
/// 指向这个 `base` 成员的有效指针
pub unsafe trait CefStruct {
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t;
}

unsafe impl CefStruct for cef_sys::_cef_v8value_t {
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        (&raw const self.base).cast_mut()
    }
}

unsafe impl CefStruct for cef_sys::_cef_v8context_t {
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        (&raw const self.base).cast_mut()
    }
}

unsafe impl CefStruct for cef_sys::_cef_v8exception_t {
    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        (&raw const self.base).cast_mut()
    }
}

/// 一个用于管理 CEF 引用计数对象的智能指针
#[repr(transparent)]
pub struct CefRefPtr<T: CefStruct> {
    ptr: NonNull<T>,
    /// 标记，用来防止意外发送到其它线程
    _phantom: PhantomData<*mut T>,
}

impl<T: CefStruct> CefRefPtr<T> {
    /// 从一个裸指针创建一个新的 `CefRefPtr` 实例
    ///
    /// 这个函数会接管裸指针的所有权，但**不会**增加它的引用计数
    ///
    /// 传入的指针要么是新创建的 (引用计数为1), 要么是已经手动增加了引用计数的
    ///
    /// # Safety
    ///
    /// 必须保证 `ptr` 是一个有效指针，其引用计数至少为 1
    ///
    /// # Errors
    ///
    /// 如果传入的指针是 `null`，返回 `CefError::NullPtrReceived`
    #[must_use = "忽略返回值会导致对象被立刻释放"]
    pub unsafe fn from_raw(ptr: *mut T) -> CefResult<Self> {
        NonNull::new(ptr)
            .map(|ptr| Self {
                ptr,
                _phantom: PhantomData,
            })
            .ok_or(CefError::NullPtrReceived)
    }

    /// 以裸指针的形式获取 `CefRefPtr` 所持有的指针
    ///
    /// 返回指针的生命周期与 `self` 相同。`self` 被 `drop` 后，这个指针
    /// 可能会变为悬垂指针
    ///
    /// 通常用于将指针传递给不取得所有权的 C API 函数
    #[must_use = "不使用它的返回值你调用它干嘛?"]
    pub const fn as_raw(&self) -> *mut T {
        self.ptr.as_ptr()
    }

    /// 将 `CefRefPtr` 转换为一个裸指针，并放弃对其的所有权。
    ///
    /// 主要用于将所有权转移给 C API。
    ///
    /// # Safety
    ///
    /// 如果不正确地使用返回的指针，可能会导致内存泄漏。
    #[must_use = "不使用返回的指针可能会导致内存泄漏"]
    pub const fn into_raw(self) -> *mut T {
        let ptr = self.ptr.as_ptr();
        std::mem::forget(self);
        ptr
    }

    fn get_base(&self) -> *mut cef_sys::_cef_base_ref_counted_t {
        unsafe { self.ptr.as_ref().get_base() }
    }
}

impl<T: CefStruct> Clone for CefRefPtr<T> {
    /// 创建 `CefRefPtr` 的一个新实例，它指向同一个 CEF 对象
    ///
    /// 这个方法会使其引用计数加一
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
