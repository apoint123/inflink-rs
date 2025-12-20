use crate::{logger, smtc_core};
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::sync::{LazyLock, Mutex, Once};
use std::{panic, ptr};
use tracing::{debug, error, instrument, trace};

fn safe_call<F, T>(func: F) -> T
where
    F: FnOnce() -> T + panic::UnwindSafe,
    T: Default,
{
    match panic::catch_unwind(func) {
        Ok(result) => result,
        Err(e) => {
            let message = e.downcast_ref::<&'static str>().map_or_else(
                || {
                    e.downcast_ref::<String>()
                        .map_or("未知类型的 Panic", |s| s.as_str())
                },
                |s| *s,
            );
            error!("一个 FFI 调用发生了 Panic: {message}");
            T::default()
        }
    }
}

const DISPATCH_ARGS: [NativeAPIType; 1] = [NativeAPIType::String];
const CALLBACK_ARGS: [NativeAPIType; 1] = [NativeAPIType::V8Value];

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

unsafe fn c_char_to_string(s: *const c_char) -> String {
    if s.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(s).to_string_lossy().into_owned() }
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_initialize(_args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        if let Err(e) = smtc_core::initialize() {
            error!("初始化失败: {e}");
        }
        ptr::null_mut()
    })
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_shutdown(_args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        logger::clear_callback();
        if let Err(e) = smtc_core::shutdown() {
            error!("关闭失败: {e}");
        }
        ptr::null_mut()
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_register_event_callback(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        let v8_func = unsafe { *args.cast::<*mut cef_safe::cef_sys::_cef_v8value_t>() };
        if !v8_func.is_null() {
            debug!("已注册事件回调");
            smtc_core::register_event_callback(v8_func);
        }
        ptr::null_mut()
    })
}

/// 用来存放返回值的缓冲区
///
/// betterncm 复制完我们的返回值后就直接丢弃了，完全没有释放内存，
/// 所以我们在 `inflink_dispatch` 直接返回一个缓冲区
///
/// 如果 betterncm 未来更新了他们的代码，
/// 又尝试保留之前的指针，这里需要修正
static RETURN_BUFFER: LazyLock<Mutex<CString>> = LazyLock::new(|| Mutex::new(CString::default()));

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_dispatch(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        if args.is_null() {
            error!("inflink_dispatch 收到了空指针");
            return ptr::null_mut();
        }
        let command_ptr = unsafe { *args.add(0) };
        if command_ptr.is_null() {
            error!("inflink_dispatch 收到了空命令指针");
            return ptr::null_mut();
        }

        let command_json = unsafe { c_char_to_string(command_ptr.cast::<c_char>()) };
        trace!(command = %command_json, "收到前端命令");

        let result_json = smtc_core::handle_command(&command_json);
        trace!(result = %result_json, "发送执行结果到前端");

        let mut buffer_guard = match RETURN_BUFFER.lock() {
            Ok(guard) => guard,
            Err(e) => {
                error!("RETURN_BUFFER 锁毒化: {e}");
                return ptr::null_mut();
            }
        };

        *buffer_guard = match CString::new(result_json) {
            Ok(s) => s,
            Err(e) => {
                error!("无法创建返回的 CString: {e}");
                CString::default()
            }
        };
        buffer_guard.as_ptr().cast_mut()
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_register_logger(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        let v8_func = unsafe { *args.cast::<*mut cef_safe::cef_sys::_cef_v8value_t>() };
        if !v8_func.is_null() {
            debug!("已注册日志回调");
            logger::register_callback(v8_func);
        }
        ptr::null_mut()
    })
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_set_log_level(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| {
        if args.is_null() {
            error!("inflink_set_log_level 收到了空指针");
            return ptr::null_mut();
        }
        let level_pointer = unsafe { *args.add(0) };
        if level_pointer.is_null() {
            error!("inflink_set_log_level 收到了空日志级别指针");
            return ptr::null_mut();
        }

        let level_string = unsafe { c_char_to_string(level_pointer.cast::<c_char>()) };
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

                let registrations = [
                    register_api(add_api, "inflink.initialize", None, inflink_initialize),
                    register_api(
                        add_api,
                        "inflink.register_logger",
                        Some(&CALLBACK_ARGS),
                        inflink_register_logger,
                    ),
                    register_api(
                        add_api,
                        "inflink.set_log_level",
                        Some(&DISPATCH_ARGS),
                        inflink_set_log_level,
                    ),
                    register_api(add_api, "inflink.shutdown", None, inflink_shutdown),
                    register_api(
                        add_api,
                        "inflink.register_event_callback",
                        Some(&CALLBACK_ARGS),
                        inflink_register_event_callback,
                    ),
                    register_api(
                        add_api,
                        "inflink.dispatch",
                        Some(&DISPATCH_ARGS),
                        inflink_dispatch,
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
