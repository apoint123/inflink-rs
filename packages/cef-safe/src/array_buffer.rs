//! 借助 CEF 的**外部化** `ArrayBuffer` 在原生与 JS 之间传递二进制数据。
//!
//! CEF 允许创建一块外部化的 `ArrayBuffer`: 缓冲区由调用方持有, CEF 只借用, 并在
//! 不再需要时通过 `release_buffer` 通知调用方。JavaScript 可以直接读写这块内存,
//! 不需要任何编码转换 —— 传封面、音频这类二进制数据时正该走这条通道。
//!
//! # 内存安全
//!
//! 缓冲区由 [`ExternalArrayBuffer`] 持有, 只把裸指针借给 CEF 与 JavaScript。
//! 为了不让 JavaScript 在缓冲区释放后还能访问它, 收尾时一定会调用
//! `neuter_array_buffer` 冻结 `ArrayBuffer` (CEF 文档保证这会触发 `release_buffer`)。
//! 因此只要冻结成功, 缓冲区就能安全地随结构体一起释放; 万一冻结失败, 缓冲区会被
//! **刻意泄漏** —— 这比留下一个 JS 仍可访问的悬垂指针安全得多, 代价是每次泄漏几 KB
//! 到几 MB, 调用方应当据此告警。

use std::{
    ffi::c_void,
    mem::size_of,
    ptr::NonNull,
    sync::atomic::{
        AtomicBool,
        AtomicUsize,
        Ordering,
    },
};

use cef_sys::{
    _cef_base_ref_counted_t,
    _cef_v8array_buffer_release_callback_t,
};

use crate::{
    error::{
        CefError,
        CefResult,
    },
    v8::CefV8Value,
    vtable::cef_ref_counted_vtable,
};

/// 交给 `cef_v8value_create_array_buffer` 的释放回调对象
///
/// CEF 会持有它, 并在 `ArrayBuffer` 不再需要缓冲区时 (被回收或被冻结) 调用一次
/// `release_buffer`。它不拥有缓冲区, 只负责引用计数与标记。
#[repr(C)]
struct BufferLease {
    /// 必须是第一个字段: 我们直接把它的地址交给 CEF, CEF 会把它当作
    /// `*mut _cef_v8array_buffer_release_callback_t` 使用
    callback: _cef_v8array_buffer_release_callback_t,
    ref_count: AtomicUsize,
    /// CEF 是否已经调用过 `release_buffer`, 仅用于观测, 不参与释放决策
    released: AtomicBool,
}

mod lease_impl {
    use std::{
        ffi::c_void,
        sync::atomic::Ordering,
    };

    use super::{
        _cef_base_ref_counted_t,
        _cef_v8array_buffer_release_callback_t,
        BufferLease,
    };

    pub(super) unsafe fn base_add_ref(base: *mut _cef_base_ref_counted_t) {
        let lease = unsafe { &*base.cast::<BufferLease>() };
        lease.ref_count.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) unsafe fn base_release(base: *mut _cef_base_ref_counted_t) -> i32 {
        let lease_ptr = base.cast::<BufferLease>();
        let lease = unsafe { &*lease_ptr };

        if lease.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            drop(unsafe { Box::from_raw(lease_ptr) });
            return 1;
        }
        0
    }

    pub(super) unsafe fn base_has_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
        let lease = unsafe { &*base.cast::<BufferLease>() };
        i32::from(lease.ref_count.load(Ordering::Relaxed) == 1)
    }

    pub(super) unsafe fn base_has_at_least_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
        let lease = unsafe { &*base.cast::<BufferLease>() };
        i32::from(lease.ref_count.load(Ordering::Relaxed) > 0)
    }

    /// CEF 通知这块缓冲区不再需要了
    ///
    /// 缓冲区不归 CEF 所有, 所以这里只做标记, 真正释放由 [`super::ExternalArrayBuffer`]
    /// 决定 —— 万一 CEF 在冻结失败后仍然调用了这里, 也只是标记而已, 不会触及内存。
    pub(super) unsafe fn release_buffer(
        self_: *mut _cef_v8array_buffer_release_callback_t,
        buffer: *mut c_void,
    ) {
        let _ = buffer;
        let lease = unsafe { &*self_.cast::<BufferLease>() };
        lease.released.store(true, Ordering::SeqCst);
    }
}

cef_ref_counted_vtable!(
    lease_impl,
    release_buffer,
    (self_: *mut _cef_v8array_buffer_release_callback_t, buffer: *mut c_void) -> ()
);

/// 持有 `BufferLease` 的一份引用, 保证在我们读取它之前不会被 CEF 回收
///
/// 我们无法确认 CEF 在创建 `ArrayBuffer` 失败时是否已经接管并释放了交出去的引用,
/// 因此多持有一份。这样无论哪种情况都能安全地读取 `released`; 最坏情况只是在失败
/// 路径上泄漏一个几十字节的 lease。
struct LeaseHandle {
    ptr: NonNull<BufferLease>,
}

impl LeaseHandle {
    fn new() -> Self {
        let lease = Box::new(BufferLease {
            callback: _cef_v8array_buffer_release_callback_t {
                base: _cef_base_ref_counted_t {
                    size: size_of::<BufferLease>(),
                    add_ref: Some(base_add_ref),
                    release: Some(base_release),
                    has_one_ref: Some(base_has_one_ref),
                    has_at_least_one_ref: Some(base_has_at_least_one_ref),
                },
                release_buffer: Some(release_buffer),
            },
            ref_count: AtomicUsize::new(1),
            released: AtomicBool::new(false),
        });

        let ptr = NonNull::new(Box::into_raw(lease)).expect("Box::into_raw 不会返回空指针");
        let handle = Self { ptr };
        handle.add_ref();
        handle
    }

    /// 额外持有一份引用
    ///
    /// 交出给 CEF 的那份算作 `new()` 里的初始计数, 这一份归我们自己。
    fn add_ref(&self) {
        let lease = unsafe { self.ptr.as_ref() };
        lease.ref_count.fetch_add(1, Ordering::Relaxed);
    }

    /// CEF 是否已经回调过 `release_buffer`
    fn is_released(&self) -> bool {
        let lease = unsafe { self.ptr.as_ref() };
        lease.released.load(Ordering::SeqCst)
    }
}

impl Drop for LeaseHandle {
    fn drop(&mut self) {
        let lease = unsafe { self.ptr.as_mut() };
        if let Some(release) = lease.callback.base.release {
            unsafe { release(&raw mut lease.callback.base) };
        }
    }
}

/// 一次二进制传输的结果
#[derive(Debug)]
pub struct ArrayBufferOutcome {
    /// JavaScript 写进缓冲区的内容
    pub bytes: Vec<u8>,
    /// 是否成功冻结了 `ArrayBuffer`
    ///
    /// 为 `false` 时缓冲区已被刻意泄漏 (见模块文档), 调用方应当记一条告警。
    pub neutered: bool,
    /// CEF 是否已经回调过 `release_buffer`
    pub released_by_cef: bool,
}

/// 一块借给 JavaScript 填写的外部化 `ArrayBuffer`
///
/// 缓冲区由本结构体持有; 交给 JS 之后, JS 可以直接读写这块内存, 直到
/// [`ExternalArrayBuffer::finish`] 冻结它为止。
pub struct ExternalArrayBuffer {
    value: CefV8Value,
    /// 缓冲区本体; 收尾 (或 `Drop`) 之后为 `None`
    buffer: Option<Box<[u8]>>,
    lease: LeaseHandle,
}

impl ExternalArrayBuffer {
    /// 分配 `size` 字节, 并包装成一个外部化的 `ArrayBuffer`
    ///
    /// 返回后应当把 [`ExternalArrayBuffer::as_v8_value`] 拿到的值交给 JavaScript
    /// (通常是调用某个 JS 函数), 再用 [`ExternalArrayBuffer::finish`] 取回内容。
    ///
    /// # Errors
    ///
    /// `size` 为 0, 或 CEF 创建 `ArrayBuffer` 失败时返回
    /// [`CefError::V8ValueCreationFailed`]。
    pub fn new(size: usize) -> CefResult<Self> {
        if size == 0 {
            return Err(CefError::V8ValueCreationFailed("array buffer: 长度为 0"));
        }

        let mut buffer = vec![0_u8; size].into_boxed_slice();
        let lease = LeaseHandle::new();

        let array_buffer_ptr = unsafe {
            cef_sys::cef_v8value_create_array_buffer(
                buffer.as_mut_ptr().cast::<c_void>(),
                size,
                &raw mut (*lease.ptr.as_ptr()).callback,
            )
        };

        // 创建失败时无法确认 CEF 是否接管了交出去的引用; `lease` 在本函数返回时被
        // 释放, 它的 `Drop` 会按引用计数决定释放还是泄漏 (见 `LeaseHandle` 的注释)。
        let value = unsafe { CefV8Value::from_raw(array_buffer_ptr) }
            .map_err(|_| CefError::V8ValueCreationFailed("array buffer"))?;

        Ok(Self {
            value,
            buffer: Some(buffer),
            lease,
        })
    }

    /// 借出内部的 V8 `ArrayBuffer`
    ///
    /// JavaScript 可以直接读写它指向的内存。冻结之前 (即在 `finish` 之前) 一直有效。
    #[must_use]
    pub const fn as_v8_value(&self) -> &CefV8Value {
        &self.value
    }

    /// 读回内容, 冻结 `ArrayBuffer` 并释放缓冲区
    ///
    /// 无论 JavaScript 回调是否成功, 都应当调用它 —— 冻结与释放都发生在这里。
    #[must_use]
    pub fn finish(mut self) -> ArrayBufferOutcome {
        self.take()
    }

    /// 取出内容并收尾; 与 `finish` 共用, 供 `Drop` 兜底
    fn take(&mut self) -> ArrayBufferOutcome {
        let Some(buffer) = self.buffer.take() else {
            return ArrayBufferOutcome {
                bytes: Vec::new(),
                neutered: false,
                released_by_cef: self.lease.is_released(),
            };
        };

        // 先读回内容再冻结: 冻结之后这块内存就正式交还给我们了
        let bytes = buffer.to_vec();

        let neutered = self.value.neuter_array_buffer();

        if neutered {
            drop(buffer);
        } else {
            // 冻结失败时 ArrayBuffer 仍可能被 JavaScript 访问, 宁可泄漏也不能留下悬垂指针
            std::mem::forget(buffer);
        }

        ArrayBufferOutcome {
            bytes,
            neutered,
            released_by_cef: self.lease.is_released(),
        }
    }
}

impl Drop for ExternalArrayBuffer {
    fn drop(&mut self) {
        // 调用方没有取内容就直接丢弃: 按同样的策略收尾 (冻结成功才释放缓冲区)
        if self.buffer.is_some() {
            let _ = self.take();
        }
    }
}
