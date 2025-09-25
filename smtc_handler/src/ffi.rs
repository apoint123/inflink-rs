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

unsafe fn c_char_to_str<'a>(s: *const c_char) -> &'a str {
    if s.is_null() {
        return "";
    }
    unsafe { CStr::from_ptr(s).to_str().unwrap_or("") }
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
    if let Some(events_json) = smtc_core::poll_events() {
        CString::new(events_json).unwrap().into_raw()
    } else {
        ptr::null_mut()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_play_state(args: *mut *mut c_void) -> *mut c_char {
    let status_code = unsafe { **(args.cast::<*mut i32>()) };
    if let Err(e) = smtc_core::update_play_state(status_code) {
        log::error!("[InfLink-rs] 更新播放状态失败: {}", e);
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_timeline(args: *mut *mut c_void) -> *mut c_char {
    let args_arr = args.cast::<*mut f64>();
    let current_ms = unsafe { **args_arr };
    let total_ms = unsafe { **(args_arr.add(1)) };
    if let Err(e) = smtc_core::update_timeline(current_ms, total_ms) {
        log::error!("[InfLink-rs] 更新时间线失败: {}", e);
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_play_mode(args: *mut *mut c_void) -> *mut c_char {
    let is_shuffling = unsafe { **(args.cast::<*mut bool>()) };
    let repeat_mode_ptr = unsafe { *(args.add(1)).cast::<*const c_char>() };
    let repeat_mode = unsafe { c_char_to_str(repeat_mode_ptr) };
    if let Err(e) = smtc_core::update_play_mode(is_shuffling, repeat_mode) {
        log::error!("[InfLink-rs] 更新播放模式失败: {}", e);
    }
    ptr::null_mut()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn inflink_update_metadata(args: *mut *mut c_void) -> *mut c_char {
    let args_arr = args.cast::<*const c_char>();
    let title = unsafe { c_char_to_str(*args_arr) };
    let artist = unsafe { c_char_to_str(*(args_arr.add(1))) };
    let album = unsafe { c_char_to_str(*(args_arr.add(2))) };
    let thumbnail = unsafe { c_char_to_str(*(args_arr.add(3))) };

    if let Err(e) = smtc_core::update_metadata(title, artist, album, thumbnail) {
        log::error!("[InfLink-rs] 更新元数据失败: {}", e);
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

        let id_init = CString::new("inflink.initialize").unwrap();
        add_api(ptr::null(), 0, id_init.as_ptr(), inflink_initialize);

        let id_shutdown = CString::new("inflink.shutdown").unwrap();
        add_api(ptr::null(), 0, id_shutdown.as_ptr(), inflink_shutdown);

        let id_poll = CString::new("inflink.poll_events").unwrap();
        add_api(ptr::null(), 0, id_poll.as_ptr(), inflink_poll_events);

        let id_state = CString::new("inflink.update_play_state").unwrap();
        add_api(
            STATE_ARGS.as_ptr(),
            1,
            id_state.as_ptr(),
            inflink_update_play_state,
        );

        let id_timeline = CString::new("inflink.update_timeline").unwrap();
        add_api(
            TIMELINE_ARGS.as_ptr(),
            2,
            id_timeline.as_ptr(),
            inflink_update_timeline,
        );

        let id_play_mode = CString::new("inflink.update_play_mode").unwrap();
        add_api(
            PLAY_MODE_ARGS.as_ptr(),
            2,
            id_play_mode.as_ptr(),
            inflink_update_play_mode,
        );

        let id_metadata = CString::new("inflink.update_metadata").unwrap();
        add_api(
            METADATA_ARGS.as_ptr(),
            4,
            id_metadata.as_ptr(),
            inflink_update_metadata,
        );
    }
    0
}
