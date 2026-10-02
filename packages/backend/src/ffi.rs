use std::{
    ffi::{
        CString,
        c_char,
        c_int,
        c_void,
    },
    ptr,
    sync::Once,
};

use tracing::{
    debug,
    error,
    instrument,
    trace,
};

use crate::{
    array_buffer::dispatchWithArrayBuffer,
    dispatcher,
    ffi_support::{
        c_char_to_string,
        return_string,
        safe_call,
    },
    logger,
    smtc_core,
};

const DISPATCH_ARGS: [NativeAPIType; 1] = [NativeAPIType::String];
const CALLBACK_ARGS: [NativeAPIType; 1] = [NativeAPIType::V8Value];
const DISPATCH_WITH_ARRAY_BUFFER_ARGS: [NativeAPIType; 3] = [
    NativeAPIType::String,
    NativeAPIType::Int,
    NativeAPIType::V8Value,
];

#[repr(i32)]
#[derive(Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum NCMProcessType {
    Undetected = 0x0,
    Main = 0x0001,
    Renderer = 0x10,
    GpuProcess = 0x100,
    Utility = 0x1000,
}

#[repr(i32)]
#[allow(dead_code)]
pub enum NativeAPIType {
    Int,
    Boolean,
    Double,
    String,
    V8Value,
}

pub type NativeFunction = unsafe extern "C" fn(args: *mut *mut c_void) -> *mut c_char;
pub type AddNativeApiFn = extern "C" fn(
    args: *const NativeAPIType,
    args_num: c_int,
    identifier: *const c_char,
    function: NativeFunction,
) -> c_int;

#[repr(C)]
pub struct PluginAPI {
    pub add_native_api: AddNativeApiFn,
    pub betterncm_version: *const c_char,
    pub process_type: NCMProcessType,
    pub ncm_version: *const [u16; 3],
}

unsafe fn register_api(
    add_api_fn: AddNativeApiFn,
    identifier_str: &str,
    args: Option<&[NativeAPIType]>,
    function: NativeFunction,
) -> Result<(), c_int> {
    let identifier = match CString::new(identifier_str) {
        Ok(s) => s,
        Err(e) => {
            error!("无法创建 CString '{identifier_str}': {e}");
            return Err(-1);
        }
    };

    let (args_ptr, args_len) = args.map_or((ptr::null(), 0), |a| (a.as_ptr(), a.len() as c_int));

    add_api_fn(args_ptr, args_len, identifier.as_ptr(), function);
    Ok(())
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn initialize(_args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        dispatcher::init();
        ptr::null_mut()
    })
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn terminate(_args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        logger::clear_callback();
        dispatcher::shutdown();
        ptr::null_mut()
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn registerEventCallback(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        let v8_func_ptr = unsafe { *args.cast::<*mut cef_safe::cef_sys::_cef_v8value_t>() };
        if !v8_func_ptr.is_null() {
            match unsafe { cef_safe::CefV8Value::from_raw(v8_func_ptr) } {
                Ok(v8_func) => {
                    debug!("已注册事件回调");
                    smtc_core::register_event_callback(v8_func);
                }
                Err(e) => error!("无法转换 V8 指针 {e:?}"),
            }
        }
        ptr::null_mut()
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dispatch(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        if args.is_null() {
            error!("dispatch 收到了空指针");
            return ptr::null_mut();
        }
        let command_ptr = unsafe { *args.add(0) };
        if command_ptr.is_null() {
            error!("dispatch 收到了空命令指针");
            return ptr::null_mut();
        }

        let command_json = c_char_to_string(command_ptr.cast::<c_char>());
        // trace!(command = %command_json, "收到前端命令");

        return_string(dispatcher::send_command(&command_json, None))
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn registerLogger(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        let v8_func_ptr = unsafe { *args.cast::<*mut cef_safe::cef_sys::_cef_v8value_t>() };
        if !v8_func_ptr.is_null() {
            match unsafe { cef_safe::CefV8Value::from_raw(v8_func_ptr) } {
                Ok(v8_func) => {
                    debug!("已注册日志回调");
                    logger::register_callback(v8_func);
                }
                Err(e) => error!("无法转换 V8 指针: {e:?}"),
            }
        }
        ptr::null_mut()
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn setLogLevel(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        if args.is_null() {
            error!("setLogLevel 收到了空指针");
            return ptr::null_mut();
        }
        let level_pointer = unsafe { *args.add(0) };
        if level_pointer.is_null() {
            error!("setLogLevel 收到了空日志级别指针");
            return ptr::null_mut();
        }

        let level_string = c_char_to_string(level_pointer.cast::<c_char>());
        if let Err(e) = logger::set_frontend_log_level(&level_string) {
            error!("设置日志级别失败: {e}");
        }

        ptr::null_mut()
    })
}

static LOGGER_INIT: Once = Once::new();

#[instrument(skip(api))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn BetterNCMPluginMain(api: *mut PluginAPI) -> c_int {
    safe_call(|| {
        LOGGER_INIT.call_once(|| {
            if let Err(e) = logger::init() {
                eprintln!("[InfLink-rs] 日志系统初始化失败: {e:?}");
            }
        });

        if api.is_null() {
            error!("BetterNCMPluginMain 收到了一个 null api 指针");
            return -1;
        }

        unsafe {
            let api_ref = &*api;
            if api_ref.process_type == NCMProcessType::Renderer {
                trace!(process_type = ?api_ref.process_type, "正在注册 API");
                let add_api = api_ref.add_native_api;

                macro_rules! reg {
                    ($func:ident, $args:expr) => {
                        register_api(
                            add_api,
                            concat!("inflink.", stringify!($func)),
                            $args,
                            $func,
                        )
                    };
                    ($func:ident) => {
                        reg!($func, None)
                    };
                }

                let registrations = [
                    reg!(initialize),
                    reg!(registerLogger, Some(&CALLBACK_ARGS)),
                    reg!(setLogLevel, Some(&DISPATCH_ARGS)),
                    reg!(terminate),
                    reg!(registerEventCallback, Some(&CALLBACK_ARGS)),
                    reg!(dispatch, Some(&DISPATCH_ARGS)),
                    reg!(
                        dispatchWithArrayBuffer,
                        Some(&DISPATCH_WITH_ARRAY_BUFFER_ARGS)
                    ),
                ];

                for result in registrations {
                    if let Err(code) = result {
                        return code;
                    }
                }
            } else {
                debug!(process_type = ?api_ref.process_type, "插件在非渲染进程中加载, 跳过注册API");
            }
        }
        0
    })
}
