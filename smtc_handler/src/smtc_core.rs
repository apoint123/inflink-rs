use anyhow::{Context, Result};
use cef_safe::{CefResult, CefV8Context, CefV8Value, renderer_post_task_in_v8_ctx};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use tracing::{debug, error, info, instrument, trace, warn};
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

use crate::model::{
    CommandResult, CommandStatus, MetadataPayload, PlaybackStatus, RepeatMode, SmtcCommand,
};

static SMTC_ACTIVATED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

const HNS_PER_MILLISECOND: f64 = 10_000.0;

use tokio::runtime::Runtime;

static TOKIO_RUNTIME: LazyLock<Runtime> =
    LazyLock::new(|| Runtime::new().expect("创建 Tokio 运行时失败"));

struct SmtcCallback {
    v8_context: CefV8Context,
    v8_function: CefV8Value,
}
// Safety: 我们目前只是把 CefRefPtr 发送到下面的 EVENT_CALLBACK
// renderer_post_task_in_v8_ctx 确保了对这些对象的操作会在相同的线程上执行
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for SmtcCallback {}

static EVENT_CALLBACK: LazyLock<Mutex<Option<SmtcCallback>>> = LazyLock::new(|| Mutex::new(None));

struct SmtcHandlerTokens {
    button_pressed: i64,
    shuffle_changed: i64,
    repeat_changed: i64,
    seek_requested: i64,
}

static HANDLER_TOKENS: LazyLock<Mutex<Option<SmtcHandlerTokens>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
enum SmtcEvent {
    Play,
    Pause,
    Stop,
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
                debug!("SMTC 事件回调已成功注册");
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
        if guard.is_some() {
            debug!("SMTC 事件回调已清理");
        }
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
            } else {
                warn!("回调任务执行时，回调函数已不存在");
            }
        });

        if post_result.is_err() {
            error!("向渲染线程发送任务失败");
        }
    } else {
        warn!("无法分发 SMTC 事件，因为没有注册回调函数");
    }
}

fn cleanup_smtc_handlers(smtc: &SystemMediaTransportControls) -> Result<()> {
    let maybe_tokens = HANDLER_TOKENS
        .lock()
        .map_err(|e| anyhow::anyhow!("HANDLER_TOKENS 锁中毒: {e}"))?
        .take();

    if let Some(tokens) = maybe_tokens {
        smtc.RemoveButtonPressed(tokens.button_pressed)?;
        smtc.RemoveShuffleEnabledChangeRequested(tokens.shuffle_changed)?;
        smtc.RemoveAutoRepeatModeChangeRequested(tokens.repeat_changed)?;
        smtc.RemovePlaybackPositionChangeRequested(tokens.seek_requested)?;
    }
    Ok(())
}

static MEDIA_PLAYER: LazyLock<Result<Mutex<MediaPlayer>>> = LazyLock::new(|| {
    let player = MediaPlayer::new()?;
    let smtc = player.SystemMediaTransportControls()?;
    smtc.SetIsEnabled(false)?;
    Ok(Mutex::new(player))
});

fn with_smtc<F, R>(context_msg: &str, f: F) -> Result<R>
where
    F: FnOnce(&SystemMediaTransportControls) -> Result<R>,
{
    match MEDIA_PLAYER.as_ref() {
        Ok(player_mutex) => {
            let smtc = player_mutex
                .lock()
                .map_err(|e| anyhow::anyhow!("获取 SMTC 锁失败 ({context_msg}): {e}"))?
                .SystemMediaTransportControls()?;
            f(&smtc)
        }
        Err(e) => Err(anyhow::anyhow!("SMTC 初始化失败 ({context_msg}): {e:?}")),
    }
}

#[instrument]
pub fn initialize() -> Result<()> {
    info!("正在初始化 SMTC...");
    SMTC_ACTIVATED.store(false, Ordering::SeqCst);

    let tokens = with_smtc("初始化", |smtc| {
        if HANDLER_TOKENS
            .lock()
            .map_err(|e| anyhow::anyhow!("HANDLER_TOKENS 锁中毒: {e}"))?
            .is_some()
        {
            warn!("发现残留的 SMTC 处理器，可能是上次未能正常关闭。正在清理");
            if let Err(e) = cleanup_smtc_handlers(smtc) {
                error!("清理残留的 SMTC 处理器失败: {e:?}");
            }
        }

        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsStopEnabled(true)?;
        smtc.SetIsNextEnabled(true)?;
        smtc.SetIsPreviousEnabled(true)?;
        debug!("已启用各个 SMTC 控制能力");

        let handler = TypedEventHandler::new(
            move |_sender: Ref<SystemMediaTransportControls>,
                  args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>|
                  -> windows::core::Result<()> {
                if let Some(args) = args.as_ref() {
                    let button = args.Button()?;
                    debug!(?button, "SMTC 按钮被按下");
                    let event = match button {
                        SystemMediaTransportControlsButton::Play => SmtcEvent::Play,
                        SystemMediaTransportControlsButton::Pause => SmtcEvent::Pause,
                        SystemMediaTransportControlsButton::Stop => SmtcEvent::Stop,
                        SystemMediaTransportControlsButton::Next => SmtcEvent::NextSong,
                        SystemMediaTransportControlsButton::Previous => SmtcEvent::PreviousSong,
                        _ => return Ok(()),
                    };
                    dispatch_event(&event);
                }
                Ok(())
            },
        );
        let button_pressed = smtc.ButtonPressed(&handler)?;

        let shuffle_handler = TypedEventHandler::new(
            move |_: Ref<SystemMediaTransportControls>,
                  _: Ref<ShuffleEnabledChangeRequestedEventArgs>|
                  -> windows::core::Result<()> {
                debug!("SMTC 请求切换随机播放模式");
                dispatch_event(&SmtcEvent::ToggleShuffle);
                Ok(())
            },
        );
        let shuffle_changed = smtc.ShuffleEnabledChangeRequested(&shuffle_handler)?;

        let repeat_handler = TypedEventHandler::new(
            move |_: Ref<SystemMediaTransportControls>,
                  _: Ref<AutoRepeatModeChangeRequestedEventArgs>|
                  -> windows::core::Result<()> {
                debug!("SMTC 请求切换重复播放模式");
                dispatch_event(&SmtcEvent::ToggleRepeat);
                Ok(())
            },
        );
        let repeat_changed = smtc.AutoRepeatModeChangeRequested(&repeat_handler)?;

        let seek_handler = TypedEventHandler::new(
            move |_: Ref<SystemMediaTransportControls>,
                  args: Ref<PlaybackPositionChangeRequestedEventArgs>|
                  -> windows::core::Result<()> {
                if let Some(args) = args.as_ref() {
                    let position = args.RequestedPlaybackPosition()?;
                    let position_ms = (position.Duration as f64) / HNS_PER_MILLISECOND;
                    debug!(position_ms, "SMTC 请求跳转播放位置");
                    dispatch_event(&SmtcEvent::Seek { position_ms });
                }
                Ok(())
            },
        );
        let seek_requested = smtc.PlaybackPositionChangeRequested(&seek_handler)?;

        debug!("SMTC 事件处理器已全部附加");

        Ok(SmtcHandlerTokens {
            button_pressed,
            shuffle_changed,
            repeat_changed,
            seek_requested,
        })
    })?;

    *HANDLER_TOKENS
        .lock()
        .map_err(|e| anyhow::anyhow!("HANDLER_TOKENS 锁中毒: {e}"))? = Some(tokens);

    debug!("SMTC 已初始化");
    Ok(())
}

#[instrument]
pub fn shutdown() -> Result<()> {
    with_smtc("关闭", |smtc| {
        cleanup_smtc_handlers(smtc).context("清理 SMTC 处理器失败")?;
        smtc.SetIsEnabled(false)?;
        Ok(())
    })?;
    clear_callback();
    SMTC_ACTIVATED.store(false, Ordering::SeqCst);
    debug!("SMTC 已关闭");
    Ok(())
}

#[instrument]
pub fn update_play_state(status: &PlaybackStatus) -> Result<()> {
    let win_status = match status {
        PlaybackStatus::Playing => MediaPlaybackStatus::Playing,
        PlaybackStatus::Paused => MediaPlaybackStatus::Paused,
    };
    debug!(new_status = ?status, "正在更新 SMTC 播放状态");

    with_smtc("更新播放状态", |smtc| {
        smtc.SetPlaybackStatus(win_status)?;
        debug!("SMTC 播放状态更新成功");
        Ok(())
    })
}

#[instrument]
pub fn update_timeline(current_ms: f64, total_ms: f64) -> Result<()> {
    debug!(current_ms, total_ms, "正在更新 SMTC 时间线");

    let props = SystemMediaTransportControlsTimelineProperties::new()?;
    props.SetStartTime(TimeSpan { Duration: 0 })?;
    props.SetPosition(TimeSpan {
        Duration: (current_ms * HNS_PER_MILLISECOND) as i64,
    })?;
    props.SetEndTime(TimeSpan {
        Duration: (total_ms * HNS_PER_MILLISECOND) as i64,
    })?;

    with_smtc("更新时间线", |smtc| {
        smtc.UpdateTimelineProperties(&props)?;
        trace!("SMTC 时间线更新成功");
        Ok(())
    })
}

#[instrument]
pub fn update_play_mode(is_shuffling: bool, repeat_mode: &RepeatMode) -> Result<()> {
    debug!(is_shuffling, ?repeat_mode, "正在更新 SMTC 播放模式");

    with_smtc("更新播放模式", |smtc| {
        smtc.SetShuffleEnabled(is_shuffling)?;

        let repeat_mode_win = match repeat_mode {
            RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
            RepeatMode::List => MediaPlaybackAutoRepeatMode::List,
            RepeatMode::None => MediaPlaybackAutoRepeatMode::None,
        };
        smtc.SetAutoRepeatMode(repeat_mode_win)?;
        debug!("SMTC 播放模式更新成功");
        Ok(())
    })
}

pub fn update_metadata(payload: MetadataPayload) {
    info!(
        title = %payload.song_name,
        artist = %payload.author_name,
        album = %payload.album_name,
        thumbnail_url = %payload.thumbnail_url,
        ncm_id = ?payload.ncm_id,
        "正在更新 SMTC 歌曲元数据"
    );

    TOKIO_RUNTIME.spawn(async move {
        let maybe_bytes = if payload.thumbnail_url.is_empty() {
            warn!("未提供封面URL, 将清空现有封面");
            None
        } else {
            debug!("正在从 URL 下载封面: {}", payload.thumbnail_url);
            match reqwest::get(&payload.thumbnail_url).await {
                Ok(response) => match response.bytes().await {
                    Ok(bytes) => Some(bytes.to_vec()),
                    Err(e) => {
                        warn!("读取封面响应失败: {}", e);
                        None
                    }
                },
                Err(e) => {
                    warn!("下载封面失败: {}", e);
                    None
                }
            }
        };

        let result = with_smtc("更新元数据", |smtc| {
            if SMTC_ACTIVATED
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                smtc.SetIsEnabled(true)?;
            }

            let updater = smtc.DisplayUpdater()?;
            updater.SetType(MediaPlaybackType::Music)?;

            let props = updater.MusicProperties()?;
            props.SetTitle(&HSTRING::from(&payload.song_name))?;
            props.SetArtist(&HSTRING::from(&payload.author_name))?;
            props.SetAlbumTitle(&HSTRING::from(&payload.album_name))?;

            let genres_collection = props.Genres()?;
            genres_collection.Clear()?;

            // 让部分应用可以精确匹配歌曲
            if let Some(ncm_id) = payload.ncm_id
                && ncm_id > 0
            {
                genres_collection.Append(&HSTRING::from(format!("NCM-{ncm_id}")))?;
                debug!("将 SMTC 流派设置为 NCM ID: {ncm_id}");
            }

            if let Some(bytes) = maybe_bytes {
                let stream = InMemoryRandomAccessStream::new()?;
                let writer = DataWriter::CreateDataWriter(&stream)?;
                writer.WriteBytes(&bytes)?;
                writer.StoreAsync()?.GetResults()?;
                writer.DetachStream()?;
                stream.Seek(0)?;
                let stream_ref = RandomAccessStreamReference::CreateFromStream(&stream)?;
                updater.SetThumbnail(&stream_ref)?;
            } else {
                updater.SetThumbnail(None)?;
                debug!("SMTC 封面已清空");
            }

            updater.Update()?;
            Ok(())
        });

        if let Err(e) = result {
            error!("更新SMTC元数据失败: {e:?}");
        }
    });
}

fn handle_command_inner(command_json: &str) -> Result<()> {
    let command: SmtcCommand = serde_json::from_str(command_json).context("解析命令 JSON 失败")?;

    debug!(?command, "正在处理命令");

    match command {
        SmtcCommand::Metadata(payload) => update_metadata(payload),
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
            let error_msg = format!("处理命令失败: {e:?}");
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
