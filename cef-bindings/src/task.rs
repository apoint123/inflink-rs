use crate::sys;

pub fn renderer_post_task<F: FnOnce() + Send + 'static>(func: F) {
    unsafe {
        #[repr(C)]
        struct ExecFunctionTask {
            base_task: sys::cef_task_t,
            func: Box<dyn FnOnce() + Send + 'static>,
        }

        #[cfg(target_arch = "x86_64")]
        extern "C" fn on_exec(task: *mut sys::cef_task_t) {
            unsafe {
                let task = Box::from_raw(task as *mut ExecFunctionTask);

                (task.func)();
            }
        }

        #[cfg(target_arch = "x86")]
        extern "stdcall" fn on_exec(task: *mut sys::cef_task_t) {
            unsafe {
                let task = Box::from_raw(task as *mut ExecFunctionTask);

                (task.func)();
            }
        }

        let task = Box::leak(Box::new(ExecFunctionTask {
            base_task: sys::cef_task_t {
                base: sys::_cef_base_ref_counted_t {
                    size: ::core::mem::size_of::<ExecFunctionTask>(),
                    ..::core::mem::zeroed()
                },
                execute: Some(on_exec),
            },
            func: Box::new(func),
        }));

        let runner = sys::cef_task_runner_get_for_thread(sys::cef_thread_id_t_TID_RENDERER)
            .as_mut()
            .unwrap();

        runner.post_task.unwrap()(runner, task as *mut _ as _);
    }
}

pub fn renderer_post_task_in_v8_ctx<F: FnOnce() + Send + 'static>(
    ctx: *mut sys::cef_v8context_t,
    func: F,
) {
    unsafe {
        #[repr(C)]
        struct ExecFunctionTask {
            base_task: sys::cef_task_t,
            func: Box<dyn FnOnce() + Send + 'static>,
            ctx: *mut sys::cef_v8context_t,
        }

        #[cfg(target_arch = "x86_64")]
        extern "C" fn on_exec(task: *mut sys::cef_task_t) {
            unsafe {
                let task = Box::from_raw(task as *mut ExecFunctionTask);
                let ctx = task.ctx.as_mut().unwrap();
                ctx.enter.unwrap()(ctx);
                (task.func)();
                ctx.exit.unwrap()(ctx);
            }
        }

        #[cfg(target_arch = "x86")]
        extern "stdcall" fn on_exec(task: *mut sys::cef_task_t) {
            unsafe {
                let task = Box::from_raw(task as *mut ExecFunctionTask);
                let ctx = task.ctx.as_mut().unwrap();
                ctx.enter.unwrap()(ctx);
                (task.func)();
                ctx.exit.unwrap()(ctx);
            }
        }

        let task = Box::leak(Box::new(ExecFunctionTask {
            base_task: sys::cef_task_t {
                base: sys::_cef_base_ref_counted_t {
                    size: ::core::mem::size_of::<ExecFunctionTask>(),
                    ..::core::mem::zeroed()
                },
                execute: Some(on_exec),
            },
            func: Box::new(func),
            ctx,
        }));

        let runner = sys::cef_task_runner_get_for_thread(sys::cef_thread_id_t_TID_RENDERER)
            .as_mut()
            .unwrap();

        runner.post_task.unwrap()(runner, task as *mut _ as _);
    }
}
