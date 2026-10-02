//! 让前端把二进制数据随命令一起送进原生, 并随这条命令交付给 dispatcher。
//!
//! 前端调用 `inflink.dispatchWithArrayBuffer(commandJson, size, callback)`: 原生分配
//! `size` 字节的缓冲区, 交给 JS 回调直接填写, 回调返回后读回内容, 并在**同一次调用里**
//! 把它挂到 `commandJson` 对应的那条命令上。目前只有 `UpdateMetadata` 会用到这段字节
//! (封面), 别的命令收到字节会被 `dispatcher` 拒绝。
//!
//! 命令与字节在同一个参数表里到达, 因此二者不可能错配 —— 不需要关联键(token), 也没有
//! 任何"两步调用必须相邻"的约定需要维护。这样封面就不必再走 base64 字符串通道, 省掉了
//! base64 编解码、随之而来的三分之一体积膨胀以及巨大的 JS 字符串。
//!
//! 二进制通道本身 (外部化 `ArrayBuffer` 的生命周期、`release_buffer` 回调、冻结) 归
//! `cef-safe`; 这里只负责 betterncm 的参数约定、尺寸上限, 以及失败时的降级。

use std::{
    ffi::{
        c_char,
        c_int,
        c_void,
    },
    time::Instant,
};

use cef_safe::{
    ArrayBufferOutcome,
    CefV8Value,
    ExternalArrayBuffer,
    cef_sys,
};
use tracing::{
    debug,
    error,
    instrument,
    warn,
};

use crate::{
    dispatcher,
    ffi_support::{
        c_char_to_string,
        return_string,
        safe_call,
    },
    model::{
        CommandResult,
        CommandStatus,
    },
};

/// 单次传输允许的最大字节数
///
/// 封面数据远小于这个量级。上限的意义是挡住异常入参: `size` 由 betterncm 按 `int`
/// 传进来, 前端传负数时转成 `usize` 会变成一个巨大的值, 直接分配会导致进程终止。
const MAX_TRANSFER_BYTES: usize = 64 * 1024 * 1024;

/// 参数层面失败时的返回, 与 `dispatcher` 的失败响应保持同一形状
fn failure(reason: &str) -> *mut c_char {
    return_string(
        serde_json::to_string(&CommandResult {
            status: CommandStatus::Error,
            message: Some(reason.to_owned()),
        })
        .expect("序列化失败响应时出错"),
    )
}

#[instrument(skip(args))]
#[allow(non_snake_case)]
pub unsafe extern "C" fn dispatchWithArrayBuffer(args: *mut *mut c_void) -> *mut c_char {
    safe_call(|| unsafe { dispatch_with_array_buffer(args) })
}

/// 解析 `[commandJson, size, callback]` 三个入参, 取回二进制后随命令一起发出去
///
/// # Safety
///
/// `args` 必须是 betterncm 按 `[String, Int, V8Value]` 约定传入的参数数组, 且至少有三个元素。
unsafe fn dispatch_with_array_buffer(args: *mut *mut c_void) -> *mut c_char {
    if args.is_null() {
        error!("dispatchWithArrayBuffer 收到空的参数指针");
        return failure("null arguments");
    }

    let (command_ptr, size_ptr, callback_ptr) =
        unsafe { (*args.add(0), *args.add(1), *args.add(2)) };
    if command_ptr.is_null() {
        error!("dispatchWithArrayBuffer 收到空的命令指针");
        return failure("null command");
    }

    let command_json = c_char_to_string(command_ptr.cast::<c_char>());

    // 二进制是尽力而为的: 取不到就退回到"没有随附二进制数据", 命令本身照发不误,
    // 后端会改用命令里带的封面 URL。把命令丢掉才是更糟的结果。
    let binary = match unsafe { take_binary(size_ptr, callback_ptr) } {
        Ok(bytes) => Some(bytes),
        Err(reason) => {
            warn!(
                reason,
                "未能随命令送出二进制数据, 该命令将按没有二进制数据的方式处理"
            );
            None
        }
    };

    return_string(dispatcher::send_command(&command_json, binary))
}

/// 校验尺寸参数, 并让 JS 回调填写缓冲区
///
/// # Safety
///
/// `size_ptr` 应指向一个 `c_int`, `callback_ptr` 应是一个有效的 V8 函数值指针。
unsafe fn take_binary(
    size_ptr: *mut c_void,
    callback_ptr: *mut c_void,
) -> Result<Vec<u8>, &'static str> {
    if size_ptr.is_null() || callback_ptr.is_null() {
        return Err("null size or callback");
    }

    let raw_size = unsafe { *size_ptr.cast::<c_int>() };
    let Ok(size) = usize::try_from(raw_size) else {
        error!(raw_size, "二进制传输收到了负数的 size");
        return Err("negative size");
    };
    if size == 0 || size > MAX_TRANSFER_BYTES {
        error!(
            size,
            max = MAX_TRANSFER_BYTES,
            "二进制传输的 size 超出允许范围"
        );
        return Err("size out of range");
    }

    unsafe { run_transfer(size, callback_ptr.cast()) }
}

/// 把缓冲区交给 JS 回调填写, 再读回内容
///
/// 成功时返回读到的字节。
///
/// # Safety
///
/// `callback_ptr` 必须是一个有效的 V8 函数值指针。
unsafe fn run_transfer(
    size: usize,
    callback_ptr: *mut cef_sys::_cef_v8value_t,
) -> Result<Vec<u8>, &'static str> {
    // betterncm 把 V8Value 参数以裸指针交给我们, 但不会额外增加引用计数
    // (参见 chromatic 的 v8NativeCalls.cpp)。这里按仓库既有约定直接接管这份引用,
    // 并在函数返回时释放: 正好抵消上游那份从未被释放的引用, 两端都不会泄漏。
    let js_callback = match unsafe { CefV8Value::from_raw(callback_ptr) } {
        Ok(callback) => callback,
        Err(e) => {
            error!("包装 JS 回调失败: {e:?}");
            return Err("invalid callback");
        }
    };

    let transfer = match ExternalArrayBuffer::new(size) {
        Ok(transfer) => transfer,
        Err(e) => {
            error!("创建外部 ArrayBuffer 失败: {e:?}");
            return Err("create_array_buffer failed");
        }
    };

    let start_time = Instant::now();

    // execute_function 会取得参数的所有权, 所以要先克隆一份, 让 transfer 继续持有引用
    let callback_result = js_callback.execute_function(None, vec![transfer.as_v8_value().clone()]);

    let duration = start_time.elapsed();

    // 无论回调成功与否都要收尾: 读回内容、冻结 ArrayBuffer、释放缓冲区
    let ArrayBufferOutcome {
        bytes,
        neutered,
        released_by_cef,
    } = transfer.finish();

    if !neutered {
        warn!("ArrayBuffer 冻结失败, 泄漏缓冲区以避免悬垂指针");
    }

    if let Err(e) = callback_result {
        error!("执行 JS 回调失败: {e:?}");
        return Err("callback failed");
    }

    let preview = bytes.get(..bytes.len().min(8)).unwrap_or_default();
    debug!(
        bytes = size,
        duration_us = duration.as_micros(),
        released = released_by_cef,
        neutered,
        ?preview,
        "已通过外部 ArrayBuffer 收到二进制数据"
    );

    Ok(bytes)
}
