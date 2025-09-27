use tracing::{debug, error, info, instrument};

use crate::{logger, smtc_core};
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::ptr;

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

unsafe fn c_char_to_string(s: *const c_char) -> String {
    if s.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(s).to_string_lossy().into_owned() }
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_initialize(_args: *mut *mut c_void) -> *mut c_char {
    if let Err(e) = smtc_core::initialize() {
        error!("[InfLink-rs] 初始化失败: {}", e);
    }
    ptr::null_mut()
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_shutdown(_args: *mut *mut c_void) -> *mut c_char {
    smtc_core::clear_callback();
    if let Err(e) = smtc_core::shutdown() {
        error!("[InfLink-rs] 关闭失败: {}", e);
    }
    ptr::null_mut()
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_register_event_callback(args: *mut *mut c_void) -> *mut c_char {
    let v8_func = unsafe { *args.cast::<*mut cef_safe::cef_sys::_cef_v8value_t>() };
    if !v8_func.is_null() {
        info!("已注册事件回调");
        smtc_core::register_event_callback(v8_func);
    }
    ptr::null_mut()
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_dispatch(args: *mut *mut c_void) -> *mut c_char {
    if args.is_null() {
        error!("[InfLink-rs] inflink_dispatch 收到了空指针");
        return ptr::null_mut();
    }
    let command_ptr = unsafe { *args.add(0) };
    if command_ptr.is_null() {
        error!("[InfLink-rs] inflink_dispatch 收到了空命令指针");
        return ptr::null_mut();
    }

    let command_json = unsafe { c_char_to_string(command_ptr.cast::<c_char>()) };
    tracing::trace!(command = %command_json, "收到前端命令");

    let result_json = smtc_core::handle_command(&command_json);
    tracing::trace!(result = %result_json, "发送执行结果到前端");

    // betterncm 不会清理这块内存 (大概是忘了)，它会泄漏
    match CString::new(result_json) {
        Ok(s) => s.into_raw(),
        Err(e) => {
            error!("[InfLink-rs] 无法创建返回的 CString: {}", e);
            ptr::null_mut()
        }
    }
}

#[instrument(skip(args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_register_logger(args: *mut *mut c_void) -> *mut c_char {
    let v8_func = unsafe { *args.cast::<*mut cef_safe::cef_sys::_cef_v8value_t>() };
    if !v8_func.is_null() {
        info!("已注册日志回调");
        logger::register_callback(v8_func);
    }
    ptr::null_mut()
}

#[instrument(skip(_args))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_cleanup(_args: *mut *mut c_void) -> *mut c_char {
    logger::clear_callback();
    smtc_core::clear_callback();
    ptr::null_mut()
}

#[instrument(skip(api))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn BetterNCMPluginMain(api: *mut PluginAPI) -> c_int {
    if api.is_null() {
        return -1;
    }

    logger::init();

    let api = unsafe { &*api };
    if api.process_type == NCMProcessType::Renderer {
        info!(process_type = ?api.process_type, "[InfLink-rs] 正在注册 API");
        let add_api = api.add_native_api;

        macro_rules! register_api {
            ($id:expr, $args:expr, $func:ident) => {
                let identifier = match CString::new($id) {
                    Ok(s) => s,
                    Err(e) => {
                        error!("[InfLink-rs] 无法创建 CString '{}': {}", $id, e);
                        return -1;
                    }
                };
                add_api(
                    $args.as_ptr(),
                    $args.len() as c_int,
                    identifier.as_ptr(),
                    $func,
                );
            };
            ($id:expr, $func:ident) => {
                let identifier = match CString::new($id) {
                    Ok(s) => s,
                    Err(e) => {
                        error!("[InfLink-rs] 无法创建 CString '{}': {}", $id, e);
                        return -1;
                    }
                };
                add_api(ptr::null(), 0, identifier.as_ptr(), $func);
            };
        }

        register_api!("inflink.initialize", inflink_initialize);
        register_api!(
            "inflink.register_logger",
            CALLBACK_ARGS,
            inflink_register_logger
        );
        register_api!("inflink.cleanup", inflink_cleanup);
        register_api!("inflink.shutdown", inflink_shutdown);
        register_api!(
            "inflink.register_event_callback",
            CALLBACK_ARGS,
            inflink_register_event_callback
        );
        register_api!("inflink.dispatch", DISPATCH_ARGS, inflink_dispatch);
    } else {
        debug!(process_type = ?api.process_type, "插件在非渲染进程中加载, 跳过注册API");
    }
    0
}
