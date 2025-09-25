use crate::smtc_core;
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::ptr;

const STATE_ARGS: [NativeAPIType; 1] = [NativeAPIType::Int];
const TIMELINE_ARGS: [NativeAPIType; 2] = [NativeAPIType::Double, NativeAPIType::Double];
const PLAY_MODE_ARGS: [NativeAPIType; 2] = [NativeAPIType::Boolean, NativeAPIType::String];
const METADATA_ARGS: [NativeAPIType; 4] = [
    NativeAPIType::String,
    NativeAPIType::String,
    NativeAPIType::String,
    NativeAPIType::String,
];

#[repr(i32)]
#[derive(Debug, PartialEq)]
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

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_initialize(_args: *mut *mut c_void) -> *mut c_char {
    if let Err(e) = smtc_core::initialize() {
        log::error!("[InfLink-rs] 初始化失败: {}", e);
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_shutdown(_args: *mut *mut c_void) -> *mut c_char {
    if let Err(e) = smtc_core::shutdown() {
        log::error!("[InfLink-rs] 关闭失败: {}", e);
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_poll_events(_args: *mut *mut c_void) -> *mut c_char {
    smtc_core::poll_events() as *mut c_char
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_play_state(args: *mut *mut c_void) -> *mut c_char {
    if args.is_null() {
        log::error!("[InfLink-rs] update_play_state 收到了空指针");
        return ptr::null_mut();
    }
    unsafe {
        let status_ptr = *args.add(0);
        if status_ptr.is_null() {
            log::error!("[InfLink-rs] update_play_state 收到了空指针");
            return ptr::null_mut();
        }

        let status_code = *status_ptr.cast::<i32>();
        if let Err(e) = smtc_core::update_play_state(status_code) {
            log::error!("[InfLink-rs] 更新播放状态失败: {}", e);
        }
    }

    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_timeline(args: *mut *mut c_void) -> *mut c_char {
    if args.is_null() {
        log::error!("[InfLink-rs] update_timeline 收到了空指针");
        return ptr::null_mut();
    }

    unsafe {
        let current_ms_ptr = *args.add(0);
        let total_ms_ptr = *args.add(1);
        if current_ms_ptr.is_null() || total_ms_ptr.is_null() {
            log::error!("[InfLink-rs] update_timeline 收到了空指针");
            return ptr::null_mut();
        }

        let current_ms = *current_ms_ptr.cast::<f64>();
        let total_ms = *total_ms_ptr.cast::<f64>();
        if let Err(e) = smtc_core::update_timeline(current_ms, total_ms) {
            log::error!("[InfLink-rs] 更新时间线失败: {}", e);
        }
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_play_mode(args: *mut *mut c_void) -> *mut c_char {
    if args.is_null() {
        log::error!("[InfLink-rs] update_play_mode 收到了空指针");
        return ptr::null_mut();
    }

    unsafe {
        let is_shuffling_ptr = *args.add(0);
        let repeat_mode_ptr = *args.add(1);
        if is_shuffling_ptr.is_null() || repeat_mode_ptr.is_null() {
            log::error!("[InfLink-rs] update_play_mode 收到了空指针");
            return ptr::null_mut();
        }

        let is_shuffling = *is_shuffling_ptr.cast::<bool>();
        let repeat_mode = c_char_to_string(repeat_mode_ptr.cast::<c_char>());
        if let Err(e) = smtc_core::update_play_mode(is_shuffling, &repeat_mode) {
            log::error!("[InfLink-rs] 更新播放模式失败: {}", e);
        }
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_metadata(args: *mut *mut c_void) -> *mut c_char {
    if args.is_null() {
        log::error!("[InfLink-rs] update_metadata 收到了空指针");
        return ptr::null_mut();
    }
    unsafe {
        let title_ptr = *args.add(0);
        let artist_ptr = *args.add(1);
        let album_ptr = *args.add(2);
        let thumbnail_ptr = *args.add(3);
        if title_ptr.is_null()
            || artist_ptr.is_null()
            || album_ptr.is_null()
            || thumbnail_ptr.is_null()
        {
            log::error!("[InfLink-rs] update_metadata 收到了空指针");
            return ptr::null_mut();
        }

        let title = c_char_to_string(title_ptr.cast::<c_char>());
        let artist = c_char_to_string(artist_ptr.cast::<c_char>());
        let album = c_char_to_string(album_ptr.cast::<c_char>());
        let thumbnail = c_char_to_string(thumbnail_ptr.cast::<c_char>());

        if let Err(e) = smtc_core::update_metadata(&title, &artist, &album, &thumbnail) {
            log::error!("[InfLink-rs] 更新元数据失败: {}", e);
        }
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn BetterNCMPluginMain(api: *mut PluginAPI) -> c_int {
    if api.is_null() {
        return -1;
    }
    let _ = env_logger::builder()
        .filter_level(log::LevelFilter::Info)
        .try_init();

    let api = unsafe { &*api };
    if api.process_type == NCMProcessType::Renderer {
        log::info!("[InfLink-rs] 正在注册 API...");
        let add_api = api.add_native_api;

        macro_rules! register_api {
            ($id:expr, $args:expr, $func:ident) => {
                let identifier = match CString::new($id) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("[InfLink-rs] 无法创建 CString '{}': {}", $id, e);
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
                        log::error!("[InfLink-rs] 无法创建 CString '{}': {}", $id, e);
                        return -1;
                    }
                };
                add_api(ptr::null(), 0, identifier.as_ptr(), $func);
            };
        }

        register_api!("inflink.initialize", inflink_initialize);
        register_api!("inflink.shutdown", inflink_shutdown);
        register_api!("inflink.poll_events", inflink_poll_events);
        register_api!(
            "inflink.update_play_state",
            STATE_ARGS,
            inflink_update_play_state
        );
        register_api!(
            "inflink.update_timeline",
            TIMELINE_ARGS,
            inflink_update_timeline
        );
        register_api!(
            "inflink.update_play_mode",
            PLAY_MODE_ARGS,
            inflink_update_play_mode
        );
        register_api!(
            "inflink.update_metadata",
            METADATA_ARGS,
            inflink_update_metadata
        );
    }
    0
}
