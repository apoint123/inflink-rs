use crate::error::{CefError, CefResult};
use crate::v8::CefV8Context;
use cef_sys::{_cef_base_ref_counted_t, _cef_task_t, cef_thread_id_t_TID_RENDERER};
use std::mem::size_of;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 一个将 Rust 闭包封装成 CEF 任务的结构体，用于在 Rust 和 CEF 之间传递
#[repr(C)]
struct RustClosureTask {
    cef_task: _cef_task_t,
    /// 需要在 CEF 线程上执行的闭包
    closure: Option<Box<dyn FnOnce() + Send + 'static>>,
    /// 任务执行时需要进入的 V8 上下文
    v8_context: CefV8Context,
    /// 手动实现的原子引用计数
    ref_count: AtomicUsize,
}

mod internal_logic {
    use super::{
        _cef_base_ref_counted_t, _cef_task_t, AssertUnwindSafe, NonNull, Ordering, RustClosureTask,
        catch_unwind,
    };

    pub(super) unsafe fn execute_rust_closure(task: *mut _cef_task_t) {
        let rust_task = unsafe { &mut *task.cast::<RustClosureTask>() };

        let v8_context_ptr = rust_task.v8_context.as_raw();
        let entered_context = unsafe {
            NonNull::new(v8_context_ptr)
                .and_then(|ctx_ptr| (*ctx_ptr.as_ptr()).enter)
                .is_some_and(|enter_func| {
                    enter_func(v8_context_ptr);
                    true
                })
        };

        if let Some(closure) = rust_task.closure.take() {
            // 使用 AssertUnwindSafe 是因为在 FFI 边界捕获 panic 是安全的
            // 这里只是为了保证下面清理代码的执行
            let _ = catch_unwind(AssertUnwindSafe(closure));
        }

        if entered_context && let Some(exit_func) = (unsafe { *v8_context_ptr }).exit {
            unsafe { exit_func(v8_context_ptr) };
        }
    }

    pub(super) unsafe fn base_add_ref(base: *mut _cef_base_ref_counted_t) {
        let task = unsafe { &*base.cast::<RustClosureTask>() };
        task.ref_count.fetch_add(1, Ordering::Relaxed);
    }

    pub(super) unsafe fn base_release(base: *mut _cef_base_ref_counted_t) -> i32 {
        let task_ptr = base.cast::<RustClosureTask>();
        let task = unsafe { &*task_ptr };

        if task.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            drop(unsafe { Box::from_raw(task_ptr) });
            return 1;
        }
        0
    }

    pub(super) unsafe fn base_has_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
        let task = unsafe { &*base.cast::<RustClosureTask>() };
        i32::from(task.ref_count.load(Ordering::Relaxed) == 1)
    }

    pub(super) unsafe fn base_has_at_least_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
        let task = unsafe { &*base.cast::<RustClosureTask>() };
        i32::from(task.ref_count.load(Ordering::Relaxed) > 0)
    }
}

#[cfg(not(all(target_arch = "x86", target_os = "windows")))]
use internal_logic::{
    base_add_ref as extern_base_add_ref,
    base_has_at_least_one_ref as extern_base_has_at_least_one_ref,
    base_has_one_ref as extern_base_has_one_ref, base_release as extern_base_release,
    execute_rust_closure as extern_execute_rust_closure,
};

#[cfg(not(all(target_arch = "x86", target_os = "windows")))]
unsafe extern "C" fn execute_rust_closure(task: *mut _cef_task_t) {
    unsafe { extern_execute_rust_closure(task) }
}
#[cfg(not(all(target_arch = "x86", target_os = "windows")))]
unsafe extern "C" fn base_add_ref(base: *mut _cef_base_ref_counted_t) {
    unsafe { extern_base_add_ref(base) }
}
#[cfg(not(all(target_arch = "x86", target_os = "windows")))]
unsafe extern "C" fn base_release(base: *mut _cef_base_ref_counted_t) -> i32 {
    unsafe { extern_base_release(base) }
}
#[cfg(not(all(target_arch = "x86", target_os = "windows")))]
unsafe extern "C" fn base_has_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
    unsafe { extern_base_has_one_ref(base) }
}
#[cfg(not(all(target_arch = "x86", target_os = "windows")))]
unsafe extern "C" fn base_has_at_least_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
    unsafe { extern_base_has_at_least_one_ref(base) }
}

#[cfg(all(target_arch = "x86", target_os = "windows"))]
use internal_logic::{
    base_add_ref as extern_base_add_ref,
    base_has_at_least_one_ref as extern_base_has_at_least_one_ref,
    base_has_one_ref as extern_base_has_one_ref, base_release as extern_base_release,
    execute_rust_closure as extern_execute_rust_closure,
};

#[cfg(all(target_arch = "x86", target_os = "windows"))]
unsafe extern "stdcall" fn execute_rust_closure(task: *mut _cef_task_t) {
    unsafe { extern_execute_rust_closure(task) }
}
#[cfg(all(target_arch = "x86", target_os = "windows"))]
unsafe extern "stdcall" fn base_add_ref(base: *mut _cef_base_ref_counted_t) {
    unsafe { extern_base_add_ref(base) }
}
#[cfg(all(target_arch = "x86", target_os = "windows"))]
unsafe extern "stdcall" fn base_release(base: *mut _cef_base_ref_counted_t) -> i32 {
    unsafe { extern_base_release(base) }
}
#[cfg(all(target_arch = "x86", target_os = "windows"))]
unsafe extern "stdcall" fn base_has_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
    unsafe { extern_base_has_one_ref(base) }
}
#[cfg(all(target_arch = "x86", target_os = "windows"))]
unsafe extern "stdcall" fn base_has_at_least_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
    unsafe { extern_base_has_at_least_one_ref(base) }
}

/// 将一个 Rust 闭包作为提交到 CEF 的渲染线程，并在指定的 V8 上下文中执行
///
/// # Parameters
/// - `v8_context`: 任务执行时需要进入的 V8 上下文, 函数会取得其所有权并管理其生命周期
/// - `f`: 一个 `FnOnce() + Send + 'static` 闭包，将在 CEF 渲染线程上执行
///
/// # Returns
/// - `Ok(())`: 任务成功提交到 CEF 的任务队列
/// - `Err(CefError::TaskPostFailed)`: 无法获取任务运行器或提交任务失败
///
/// # Example
/// ```no_run
/// use cef_safe::{CefV8Context, renderer_post_task_in_v8_ctx};
///
/// if let Ok(context) = CefV8Context::current() {
///     let task_result = renderer_post_task_in_v8_ctx(context, || {
///         // 做一些事情...
///     });
///
///     if task_result.is_err() {
///         eprintln!("提交任务失败");
///     }
/// }
/// ```
#[must_use = "忽略返回值你就无法知道任务是否成功提交了"]
pub fn renderer_post_task_in_v8_ctx<F>(v8_context: CefV8Context, f: F) -> CefResult<()>
where
    F: FnOnce() + Send + 'static,
{
    unsafe {
        let task_runner_ptr = cef_sys::cef_task_runner_get_for_thread(cef_thread_id_t_TID_RENDERER);
        if task_runner_ptr.is_null() {
            return Err(CefError::TaskPostFailed);
        }

        let rust_task = Box::new(RustClosureTask {
            cef_task: _cef_task_t {
                base: _cef_base_ref_counted_t {
                    size: size_of::<RustClosureTask>(),
                    add_ref: Some(base_add_ref),
                    release: Some(base_release),
                    has_one_ref: Some(base_has_one_ref),
                    has_at_least_one_ref: Some(base_has_at_least_one_ref),
                },
                execute: Some(execute_rust_closure),
            },
            closure: Some(Box::new(f)),
            v8_context,
            ref_count: AtomicUsize::new(1),
        });

        let task_ptr = Box::leak(rust_task) as *mut RustClosureTask;

        let success = (*task_runner_ptr)
            .post_task
            .is_some_and(|post_task_func| post_task_func(task_runner_ptr, task_ptr.cast()) == 1);

        if success {
            Ok(())
        } else {
            drop(Box::from_raw(task_ptr));
            Err(CefError::TaskPostFailed)
        }
    }
}
