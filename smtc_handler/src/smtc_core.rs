use anyhow::{Context, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use cef_safe::{CefResult, CefV8Context, CefV8Value, renderer_post_task_in_v8_ctx};
use serde::Serialize;
use std::sync::{LazyLock, Mutex};
use tracing::{debug, error, info, instrument, warn};
use windows::{
    Foundation::{TimeSpan, TypedEventHandler},
    Media::Playback::MediaPlayer,
    Media::{
        AutoRepeatModeChangeRequestedEventArgs, MediaPlaybackAutoRepeatMode, MediaPlaybackStatus,
        MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        ShuffleEnabledChangeRequestedEventArgs, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
    core::{HSTRING, Ref},
};

use crate::model::{CommandResult, CommandStatus, PlaybackStatus, SmtcCommand};

const HNS_PER_MILLISECOND: f64 = 10_000.0;

struct SmtcCallback {
    v8_context: CefV8Context,
    v8_function: CefV8Value,
}
// Safety: 我们目前只是把 CefRefPtr 发送到下面的 EVENT_CALLBACK
// renderer_post_task_in_v8_ctx 确保了对这些对象的操作会在相同的线程上执行
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for SmtcCallback {}

static EVENT_CALLBACK: LazyLock<Mutex<Option<SmtcCallback>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
enum SmtcEvent {
    Play,
    Pause,
    NextSong,
    PreviousSong,
    ToggleShuffle,
    ToggleRepeat,
    Seek { position_ms: f64 },
}

pub fn register_event_callback(v8_func_ptr: *mut cef_safe::cef_sys::_cef_v8value_t) {
    let callback_result: CefResult<SmtcCallback> = (|| {
        let v8_context = CefV8Context::current()?;
        let v8_function = unsafe { CefV8Value::from_raw(v8_func_ptr)? };
        Ok(SmtcCallback {
            v8_context,
            v8_function,
        })
    })();

    if let Ok(mut guard) = EVENT_CALLBACK.lock() {
        match callback_result {
            Ok(callback) => {
                *guard = Some(callback);
                info!("SMTC 事件回调已成功注册");
            }
            Err(e) => {
                error!("注册 SMTC 事件回调失败: {:?}", e);
                *guard = None;
            }
        }
    } else {
        error!("注册 SMTC 事件回调时锁中毒");
    }
}

pub fn clear_callback() {
    if let Ok(mut guard) = EVENT_CALLBACK.lock() {
        *guard = None;
    } else {
        error!("清理 SMTC 回调时锁中毒");
    }
}

#[instrument]
fn dispatch_event(event: &SmtcEvent) {
    debug!(?event, "分发 SMTC 事件");

    let event_json = match serde_json::to_string(&event) {
        Ok(json) => json,
        Err(e) => {
            error!("反序列化SMTC事件失败: {}", e);
            return;
        }
    };

    let maybe_context = if let Ok(guard) = EVENT_CALLBACK.lock() {
        guard.as_ref().map(|cb| cb.v8_context.clone())
    } else {
        error!("SMTC 事件回调锁毒化");
        return;
    };

    if let Some(context) = maybe_context {
        let post_result = renderer_post_task_in_v8_ctx(context, move || {
            let Ok(guard) = EVENT_CALLBACK.lock() else {
                error!("SMTC 事件回调锁在任务中毒化");
                return;
            };

            if let Some(callback) = guard.as_ref() {
                match CefV8Value::try_from_str(&event_json) {
                    Ok(arg) => {
                        if let Err(e) = callback.v8_function.execute_function(None, vec![arg]) {
                            error!("JS 回调函数执行失败: {e:?}");
                        }
                    }
                    Err(e) => {
                        error!("创建 V8 字符串参数失败: {e:?}");
                    }
                }
            }
        });

        if post_result.is_err() {
            error!("向渲染线程发送任务失败");
        }
    }
}

static MEDIA_PLAYER: LazyLock<Mutex<MediaPlayer>> = LazyLock::new(|| {
    let player = MediaPlayer::new().expect("无法创建 MediaPlayer 实例");
    let smtc = player
        .SystemMediaTransportControls()
        .expect("无法获取 SMTC");
    smtc.SetIsEnabled(false).expect("无法禁用 SMTC");
    Mutex::new(player)
});

#[instrument]
pub fn initialize() -> Result<()> {
    let smtc = MEDIA_PLAYER
        .lock()
        .map_err(|e| anyhow::anyhow!("初始化时 SMTC 锁中毒: {e}"))?
        .SystemMediaTransportControls()?;

    smtc.SetIsEnabled(true)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;
    info!("已启用各个 SMTC 控制能力");

    let handler = TypedEventHandler::new(
        move |_sender: Ref<SystemMediaTransportControls>,
              args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>|
              -> windows::core::Result<()> {
            if let Some(args) = args.as_ref() {
                let event = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => SmtcEvent::Play,
                    SystemMediaTransportControlsButton::Pause => SmtcEvent::Pause,
                    SystemMediaTransportControlsButton::Next => SmtcEvent::NextSong,
                    SystemMediaTransportControlsButton::Previous => SmtcEvent::PreviousSong,
                    _ => return Ok(()),
                };
                dispatch_event(&event);
            }
            Ok(())
        },
    );
    smtc.ButtonPressed(&handler)?;

    let shuffle_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<ShuffleEnabledChangeRequestedEventArgs>|
              -> windows::core::Result<()> {
            dispatch_event(&SmtcEvent::ToggleShuffle);
            Ok(())
        },
    );
    smtc.ShuffleEnabledChangeRequested(&shuffle_handler)?;

    let repeat_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<AutoRepeatModeChangeRequestedEventArgs>|
              -> windows::core::Result<()> {
            dispatch_event(&SmtcEvent::ToggleRepeat);
            Ok(())
        },
    );
    smtc.AutoRepeatModeChangeRequested(&repeat_handler)?;

    let seek_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              args: Ref<PlaybackPositionChangeRequestedEventArgs>|
              -> windows::core::Result<()> {
            if let Some(args) = args.as_ref() {
                let position = args.RequestedPlaybackPosition()?;
                let position_ms = (position.Duration as f64) / HNS_PER_MILLISECOND;
                dispatch_event(&SmtcEvent::Seek { position_ms });
            }
            Ok(())
        },
    );
    smtc.PlaybackPositionChangeRequested(&seek_handler)?;

    info!("SMTC 已初始化");
    Ok(())
}

#[instrument]
pub fn shutdown() -> Result<()> {
    MEDIA_PLAYER
        .lock()
        .map_err(|e| anyhow::anyhow!("关闭时 SMTC 锁中毒: {e}"))?
        .SystemMediaTransportControls()?
        .SetIsEnabled(false)?;
    clear_callback();
    Ok(())
}

#[instrument]
pub fn update_play_state(status: &PlaybackStatus) -> Result<()> {
    let win_status = match status {
        PlaybackStatus::Playing => MediaPlaybackStatus::Playing,
        PlaybackStatus::Paused => MediaPlaybackStatus::Paused,
    };
    info!(new_status = ?status, "正在更新 SMTC 播放状态");

    MEDIA_PLAYER
        .lock()
        .map_err(|e| anyhow::anyhow!("更新播放状态时 SMTC 锁中毒: {e}"))?
        .SystemMediaTransportControls()?
        .SetPlaybackStatus(win_status)?;
    Ok(())
}

#[instrument]
pub fn update_timeline(current_ms: f64, total_ms: f64) -> Result<()> {
    info!(current_ms, total_ms, "正在更新 SMTC 时间线");

    let props = SystemMediaTransportControlsTimelineProperties::new()?;
    props.SetStartTime(TimeSpan { Duration: 0 })?;
    props.SetPosition(TimeSpan {
        Duration: (current_ms * HNS_PER_MILLISECOND) as i64,
    })?;
    props.SetEndTime(TimeSpan {
        Duration: (total_ms * HNS_PER_MILLISECOND) as i64,
    })?;

    MEDIA_PLAYER
        .lock()
        .map_err(|e| anyhow::anyhow!("更新时间线时 SMTC 锁中毒: {e}"))?
        .SystemMediaTransportControls()?
        .UpdateTimelineProperties(&props)?;
    Ok(())
}

#[instrument]
pub fn update_play_mode(is_shuffling: bool, repeat_mode_str: &str) -> Result<()> {
    info!(
        is_shuffling,
        repeat_mode = repeat_mode_str,
        "正在更新 SMTC 播放模式"
    );

    let smtc = MEDIA_PLAYER
        .lock()
        .map_err(|e| anyhow::anyhow!("更新播放模式时 SMTC 锁中毒: {e}"))?
        .SystemMediaTransportControls()?;

    smtc.SetShuffleEnabled(is_shuffling)?;

    let repeat_mode = match repeat_mode_str {
        "Track" => MediaPlaybackAutoRepeatMode::Track,
        "List" => MediaPlaybackAutoRepeatMode::List,
        _ => MediaPlaybackAutoRepeatMode::None,
    };
    smtc.SetAutoRepeatMode(repeat_mode)?;
    Ok(())
}

pub fn update_metadata(
    title: &str,
    artist: &str,
    album: &str,
    thumbnail_base64: &str,
) -> Result<()> {
    info!(
        title = %title,
        artist = %artist,
        album = %album,
        // thumbnail_provided = !thumbnail_base64.is_empty(),
        "正在更新 SMTC 歌曲元数据"
    );

    let updater = MEDIA_PLAYER
        .lock()
        .map_err(|e| anyhow::anyhow!("更新元数据时 SMTC 锁中毒: {e}"))?
        .SystemMediaTransportControls()?
        .DisplayUpdater()?;

    updater.SetType(MediaPlaybackType::Music)?;

    let props = updater.MusicProperties()?;
    props.SetTitle(&HSTRING::from(title))?;
    props.SetArtist(&HSTRING::from(artist))?;
    props.SetAlbumTitle(&HSTRING::from(album))?;

    if let Ok(bytes) = STANDARD.decode(thumbnail_base64) {
        debug!(bytes_len = bytes.len(), "封面数据已准备好, 长度:");

        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes)?;
        writer.StoreAsync()?.GetResults()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        let stream_ref = RandomAccessStreamReference::CreateFromStream(&stream)?;
        updater.SetThumbnail(&stream_ref)?;
    } else if !thumbnail_base64.is_empty() {
        warn!("解码 Base64 字符串失败");
    }

    updater.Update()?;
    Ok(())
}

fn handle_command_inner(command_json: &str) -> Result<()> {
    let command: SmtcCommand = serde_json::from_str(command_json).context("解析命令 JSON 失败")?;

    debug!(?command, "正在处理命令");

    match command {
        SmtcCommand::Metadata(payload) => update_metadata(
            &payload.song_name,
            &payload.author_name,
            &payload.album_name,
            &payload.thumbnail_base64,
        )
        .context("更新元数据失败")?,
        SmtcCommand::PlayState(payload) => {
            update_play_state(&payload.status).context("更新播放状态失败")?;
        }
        SmtcCommand::Timeline(payload) => {
            update_timeline(payload.current_time, payload.total_time).context("更新时间线失败")?;
        }
        SmtcCommand::PlayMode(payload) => {
            update_play_mode(payload.is_shuffling, &payload.repeat_mode)
                .context("更新播放模式失败")?;
        }
    }

    Ok(())
}

#[instrument(skip(command_json))]
pub fn handle_command(command_json: &str) -> String {
    let result = match handle_command_inner(command_json) {
        Ok(()) => CommandResult {
            status: CommandStatus::Success,
            message: None,
        },
        Err(e) => {
            let error_msg = format!("解析命令失败: {e}");
            error!("{error_msg}");
            CommandResult {
                status: CommandStatus::Error,
                message: Some(error_msg),
            }
        }
    };

    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!("{{\"status\":\"Error\",\"message\":\"序列化结果失败: {e}\"}}"))
}
