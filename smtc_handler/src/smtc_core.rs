use anyhow::{Context, Result};
use base64::Engine;
use base64::engine::general_purpose;
use cef_safe::{CefResult, CefV8Context, CefV8Value, renderer_post_task_in_v8_ctx};
use serde::Serialize;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tokio::runtime::Runtime;
use tokio::task::JoinHandle;
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

use crate::discord;
use crate::model::{
    CommandResult, CommandStatus, CoverSource, MetadataPayload, PlaybackStatus, RepeatMode,
    SmtcCommand,
};

const HNS_PER_MILLISECOND: f64 = 10_000.0;

static TOKIO_RUNTIME: LazyLock<Runtime> =
    LazyLock::new(|| Runtime::new().expect("创建 Tokio 运行时失败"));

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.23.204750")
        .build()
        .expect("创建 HTTP 客户端失败")
});

struct SmtcCallback {
    v8_context: CefV8Context,
    v8_function: CefV8Value,
}

#[allow(
    clippy::non_send_fields_in_send_ty,
    reason = "已确保使用 renderer_post_task_in_v8_ctx 在正确的线程上执行对这些对象的操作"
)]
unsafe impl Send for SmtcCallback {}

struct SmtcHandlerTokens {
    button_pressed: i64,
    shuffle_changed: i64,
    repeat_changed: i64,
    seek_requested: i64,
}

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

struct SmtcContext {
    player: MediaPlayer,
    tokens: SmtcHandlerTokens,
    callback: Option<SmtcCallback>,
    cover_task: Option<JoinHandle<()>>,
}

impl SmtcContext {
    fn smtc(&self) -> Result<SystemMediaTransportControls> {
        Ok(self.player.SystemMediaTransportControls()?)
    }

    fn remove_handlers(&self) -> Result<()> {
        let smtc = self.smtc()?;
        smtc.RemoveButtonPressed(self.tokens.button_pressed)?;
        smtc.RemoveShuffleEnabledChangeRequested(self.tokens.shuffle_changed)?;
        smtc.RemoveAutoRepeatModeChangeRequested(self.tokens.repeat_changed)?;
        smtc.RemovePlaybackPositionChangeRequested(self.tokens.seek_requested)?;
        Ok(())
    }
}

impl Drop for SmtcContext {
    fn drop(&mut self) {
        if let Some(handle) = self.cover_task.take() {
            handle.abort();
        }

        if let Err(e) = self.remove_handlers() {
            warn!("销毁 SmtcContext 时移除处理器失败: {e:?}");
        }

        if let Ok(smtc) = self.smtc() {
            let _ = smtc.SetIsEnabled(false);
        }
    }
}

static SMTC_CONTEXT: LazyLock<Mutex<Option<SmtcContext>>> = LazyLock::new(|| Mutex::new(None));

pub fn register_event_callback(v8_func_ptr: *mut cef_safe::cef_sys::_cef_v8value_t) {
    let callback_result: CefResult<SmtcCallback> = (|| {
        let v8_context = CefV8Context::current()?;
        let v8_function = unsafe { CefV8Value::from_raw(v8_func_ptr)? };
        Ok(SmtcCallback {
            v8_context,
            v8_function,
        })
    })();

    match SMTC_CONTEXT.lock() {
        Ok(mut guard) => {
            if let Some(ctx) = guard.as_mut() {
                match callback_result {
                    Ok(cb) => {
                        ctx.callback = Some(cb);
                        debug!("SMTC 事件回调已成功注册");
                    }
                    Err(e) => error!("创建回调对象失败: {e:?}"),
                }
            } else {
                warn!("尝试注册回调，但 SMTC 未初始化");
            }
        }
        Err(e) => error!("注册回调时锁中毒: {e:?}"),
    }
}

pub fn clear_callback() {
    if let Ok(mut guard) = SMTC_CONTEXT.lock()
        && let Some(ctx) = guard.as_mut()
    {
        ctx.callback = None;
        debug!("SMTC 事件回调已清理");
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
            error!("反序列化SMTC事件失败: {e}");
            return;
        }
    };

    let maybe_v8_ctx = if let Ok(guard) = SMTC_CONTEXT.lock() {
        guard
            .as_ref()
            .and_then(|ctx| ctx.callback.as_ref().map(|cb| cb.v8_context.clone()))
    } else {
        error!("SMTC 事件回调锁毒化");
        return;
    };

    if let Some(v8_ctx) = maybe_v8_ctx {
        let post_result = renderer_post_task_in_v8_ctx(v8_ctx, move || {
            let Ok(guard) = SMTC_CONTEXT.lock() else {
                error!("SMTC 事件回调锁在任务中毒化");
                return;
            };

            if let Some(ctx) = guard.as_ref()
                && let Some(cb) = ctx.callback.as_ref()
            {
                match CefV8Value::try_from_str(&event_json) {
                    Ok(arg) => {
                        if let Err(e) = cb.v8_function.execute_function(None, vec![arg]) {
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

#[instrument]
pub fn initialize() -> Result<()> {
    info!("正在初始化 SMTC...");
    discord::init();

    let player = MediaPlayer::new()?;
    let smtc = player.SystemMediaTransportControls()?;

    smtc.SetIsEnabled(false)?;
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
              _: Ref<ShuffleEnabledChangeRequestedEventArgs>| {
            debug!("SMTC 请求切换随机播放模式");
            dispatch_event(&SmtcEvent::ToggleShuffle);
            Ok(())
        },
    );
    let shuffle_changed = smtc.ShuffleEnabledChangeRequested(&shuffle_handler)?;

    let repeat_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<AutoRepeatModeChangeRequestedEventArgs>| {
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

    let context = SmtcContext {
        player,
        tokens: SmtcHandlerTokens {
            button_pressed,
            shuffle_changed,
            repeat_changed,
            seek_requested,
        },
        callback: None,
        cover_task: None,
    };

    {
        let mut guard = SMTC_CONTEXT
            .lock()
            .map_err(|e| anyhow::anyhow!("SmtcContext 锁中毒: {e}"))?;
        *guard = Some(context);
    }

    debug!("SMTC 已初始化");
    Ok(())
}

#[instrument]
pub fn shutdown() -> Result<()> {
    if let Ok(mut guard) = SMTC_CONTEXT.lock() {
        *guard = None;
    } else {
        error!("关闭时锁中毒");
    }

    discord::disable();
    debug!("SMTC 已关闭");
    Ok(())
}

fn with_smtc_ctx<F>(action_name: &str, f: F) -> Result<()>
where
    F: FnOnce(&mut SmtcContext) -> Result<()>,
{
    let mut guard = SMTC_CONTEXT
        .lock()
        .map_err(|e| anyhow::anyhow!("获取 SMTC 锁失败 ({action_name}): {e}"))?;

    guard.as_mut().map_or_else(
        || {
            warn!("尝试执行 {action_name}，但 SMTCContext 未初始化");
            Ok(())
        },
        f,
    )
}

#[instrument]
pub fn update_play_state(status: PlaybackStatus) -> Result<()> {
    let win_status = match status {
        PlaybackStatus::Playing => MediaPlaybackStatus::Playing,
        PlaybackStatus::Paused => MediaPlaybackStatus::Paused,
    };
    debug!(new_status = ?status, "正在更新 SMTC 播放状态");

    with_smtc_ctx("更新播放状态", |ctx| {
        let smtc = ctx.smtc()?;
        smtc.SetPlaybackStatus(win_status)?;
        debug!("SMTC 播放状态更新成功");
        Ok(())
    })
}

#[instrument]
pub fn update_timeline(current_ms: f64, total_ms: f64) -> Result<()> {
    trace!(current_ms, total_ms, "正在更新 SMTC 时间线");

    let props = SystemMediaTransportControlsTimelineProperties::new()?;
    props.SetStartTime(TimeSpan { Duration: 0 })?;
    props.SetPosition(TimeSpan {
        Duration: (current_ms * HNS_PER_MILLISECOND) as i64,
    })?;
    props.SetEndTime(TimeSpan {
        Duration: (total_ms * HNS_PER_MILLISECOND) as i64,
    })?;

    with_smtc_ctx("更新时间线", |ctx| {
        let smtc = ctx.smtc()?;
        smtc.UpdateTimelineProperties(&props)?;
        Ok(())
    })
}

#[instrument]
pub fn update_play_mode(is_shuffling: bool, repeat_mode: &RepeatMode) -> Result<()> {
    debug!(is_shuffling, ?repeat_mode, "正在更新 SMTC 播放模式");

    with_smtc_ctx("更新播放模式", |ctx| {
        let smtc = ctx.smtc()?;
        smtc.SetShuffleEnabled(is_shuffling)?;

        let repeat_mode_win = match repeat_mode {
            RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
            RepeatMode::List => MediaPlaybackAutoRepeatMode::List,
            RepeatMode::None | RepeatMode::AI => MediaPlaybackAutoRepeatMode::None,
        };
        smtc.SetAutoRepeatMode(repeat_mode_win)?;
        debug!("SMTC 播放模式更新成功");
        Ok(())
    })
}

async fn get_cover_stream_ref(cover: Option<CoverSource>) -> Option<RandomAccessStreamReference> {
    let bytes = match cover {
        None => {
            warn!("未提供封面, 将清空现有封面");
            return None;
        }
        Some(CoverSource::Base64(base64_data)) => {
            debug!("正在从 Base64 数据解码封面");
            let start_time = Instant::now();

            match general_purpose::STANDARD.decode(base64_data) {
                Ok(b) => {
                    let elapsed = start_time.elapsed();
                    debug!(duration = ?elapsed, "封面 Base64 解码完成");
                    b
                }
                Err(e) => {
                    warn!("解码封面 Base64 失败: {e}");
                    return None;
                }
            }
        }
        Some(CoverSource::Url(url)) => {
            debug!("正在从 URL 下载封面: {url}");
            let start_time = Instant::now();

            match HTTP_CLIENT.get(&url).send().await {
                Ok(res) => match res.bytes().await {
                    Ok(b) => {
                        let elapsed = start_time.elapsed();
                        debug!(duration = ?elapsed, "封面下载成功");
                        b.to_vec()
                    }
                    Err(e) => {
                        let elapsed = start_time.elapsed();
                        warn!(duration = ?elapsed, "读取封面响应失败: {e}");
                        return None;
                    }
                },
                Err(e) => {
                    let elapsed = start_time.elapsed();
                    warn!(duration = ?elapsed, "下载封面失败: {e}");
                    return None;
                }
            }
        }
    };

    let stream_result: windows::core::Result<RandomAccessStreamReference> = (async {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes)?;
        writer.StoreAsync()?.await?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        RandomAccessStreamReference::CreateFromStream(&stream)
    })
    .await;

    match stream_result {
        Ok(stream_ref) => Some(stream_ref),
        Err(e) => {
            error!("创建封面内存流失败: {e:?}");
            None
        }
    }
}

#[instrument]
pub fn update_metadata(payload: MetadataPayload) {
    info!(
        title = %payload.song_name,
        artist = %payload.author_name,
        album = %payload.album_name,
        ncm_id = ?payload.ncm_id,
        "正在更新 SMTC 歌曲元数据"
    );

    let Ok(mut guard) = SMTC_CONTEXT.lock() else {
        error!("SmtcContext 锁中毒");
        return;
    };

    let Some(ctx) = guard.as_mut() else {
        return;
    };

    if let Some(old_handle) = ctx.cover_task.take() {
        old_handle.abort();
    }

    let new_handle = TOKIO_RUNTIME.spawn(async move {
        let thumbnail_stream_ref = get_cover_stream_ref(payload.cover).await;

        let result = with_smtc_ctx("更新元数据", |inner_ctx| {
            let smtc = inner_ctx.smtc()?;
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
            }

            if let Some(stream_ref) = thumbnail_stream_ref.as_ref() {
                updater.SetThumbnail(stream_ref)?;
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

    ctx.cover_task = Some(new_handle);
}

fn handle_command_inner(command_json: &str) -> Result<()> {
    let command: SmtcCommand = serde_json::from_str(command_json).context("解析命令 JSON 失败")?;

    debug!(?command, "正在处理命令");

    match command {
        SmtcCommand::Metadata(payload) => {
            discord::update_metadata(payload.clone());
            update_metadata(payload);
        }
        SmtcCommand::PlayState(payload) => {
            discord::update_play_state(payload.clone());
            update_play_state(payload.status).context("更新播放状态失败")?;
        }
        SmtcCommand::Timeline(payload) => {
            discord::update_timeline(payload.clone());
            update_timeline(payload.current_time, payload.total_time).context("更新时间线失败")?;
        }
        SmtcCommand::PlayMode(payload) => {
            update_play_mode(payload.is_shuffling, &payload.repeat_mode)
                .context("更新播放模式失败")?;
        }
        SmtcCommand::EnableSmtc => {
            with_smtc_ctx("启用 SMTC", |ctx| Ok(ctx.smtc()?.SetIsEnabled(true)?))?;
        }
        SmtcCommand::DisableSmtc => {
            with_smtc_ctx("禁用 SMTC", |ctx| Ok(ctx.smtc()?.SetIsEnabled(false)?))?;
        }
        SmtcCommand::EnableDiscordRpc => {
            discord::enable();
        }
        SmtcCommand::DisableDiscordRpc => {
            discord::disable();
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
