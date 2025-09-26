use crate::v8::CefV8Context;
use cef_sys::{_cef_base_ref_counted_t, _cef_task_t, cef_thread_id_t_TID_RENDERER};
use std::mem::size_of;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicUsize, Ordering};

#[repr(C)]
struct RustClosureTask {
    cef_task: _cef_task_t,
    closure: Option<Box<dyn FnOnce() + Send + 'static>>,
    v8_context: CefV8Context,
    ref_count: AtomicUsize,
}

unsafe extern "C" fn execute_rust_closure(task: *mut _cef_task_t) {
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

pub unsafe fn renderer_post_task_in_v8_ctx<F>(v8_context: CefV8Context, f: F) -> bool
where
    F: FnOnce() + Send + 'static,
{
    unsafe {
        let task_runner_ptr = cef_sys::cef_task_runner_get_for_thread(cef_thread_id_t_TID_RENDERER);
        if task_runner_ptr.is_null() {
            return false;
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

        if !success {
            drop(Box::from_raw(task_ptr));
        }

        success
    }
}

unsafe extern "C" fn base_add_ref(base: *mut _cef_base_ref_counted_t) {
    let task = unsafe { &*base.cast::<RustClosureTask>() };
    task.ref_count.fetch_add(1, Ordering::Relaxed);
}

unsafe extern "C" fn base_release(base: *mut _cef_base_ref_counted_t) -> i32 {
    let task_ptr = base.cast::<RustClosureTask>();
    let task = unsafe { &*task_ptr };

    if task.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
        drop(unsafe { Box::from_raw(task_ptr) });
        return 1;
    }
    0
}

unsafe extern "C" fn base_has_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
    let task = unsafe { &*base.cast::<RustClosureTask>() };
    i32::from(task.ref_count.load(Ordering::Relaxed) == 1)
}

unsafe extern "C" fn base_has_at_least_one_ref(base: *mut _cef_base_ref_counted_t) -> i32 {
    let task = unsafe { &*base.cast::<RustClosureTask>() };
    i32::from(task.ref_count.load(Ordering::Relaxed) > 0)
}
