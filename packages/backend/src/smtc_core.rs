use std::{
    sync::{
        LazyLock,
        Mutex,
    },
    time::Instant,
};

use anyhow::Result;
use base64::{
    Engine,
    engine::general_purpose,
};
use cef_safe::{
    CefResult,
    CefV8Context,
    CefV8Value,
    renderer_post_task_in_v8_ctx,
};
use serde::Serialize;
use tracing::{
    debug,
    error,
    info,
    instrument,
    warn,
};
use windows::{
    Foundation::{
        TimeSpan,
        TypedEventHandler,
        Uri,
    },
    Media::{
        AutoRepeatModeChangeRequestedEventArgs,
        MediaPlaybackAutoRepeatMode,
        MediaPlaybackStatus,
        MediaPlaybackType,
        Playback::MediaPlayer,
        PlaybackPositionChangeRequestedEventArgs,
        ShuffleEnabledChangeRequestedEventArgs,
        SystemMediaTransportControls,
        SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::{
        DataWriter,
        InMemoryRandomAccessStream,
        RandomAccessStreamReference,
    },
    core::{
        HSTRING,
        Ref,
    },
};

use crate::model::{
    CoverSource,
    MetadataPayload,
    PlaybackStatus,
    RepeatMode,
};

const HNS_PER_MILLISECOND: f64 = 10_000.0;

static GLOBAL_CALLBACK: LazyLock<Mutex<Option<SmtcCallback>>> = LazyLock::new(|| Mutex::new(None));

struct SmtcCallback {
    v8_context: CefV8Context,
    v8_function: CefV8Value,
}

#[allow(
    clippy::non_send_fields_in_send_ty,
    reason = "已确保使用 renderer_post_task_in_v8_ctx 在正确的线程上执行对这些对象的操作"
)]
unsafe impl Send for SmtcCallback {}

#[derive(Debug)]
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

#[derive(Debug)]
pub struct SmtcContext {
    player: MediaPlayer,
    tokens: SmtcHandlerTokens,
    is_enabled: bool,
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
        if let Err(e) = self.remove_handlers() {
            warn!("销毁 SmtcContext 时移除处理器失败: {e:?}");
        }

        if let Ok(smtc) = self.smtc() {
            let _ = smtc.SetIsEnabled(false);
        }
    }
}

pub fn register_event_callback(v8_function: CefV8Value) {
    let callback_result: CefResult<SmtcCallback> = (|| {
        let v8_context = CefV8Context::current()?;
        Ok(SmtcCallback {
            v8_context,
            v8_function,
        })
    })();

    match GLOBAL_CALLBACK.lock() {
        Ok(mut guard) => match callback_result {
            Ok(cb) => {
                *guard = Some(cb);
                debug!("SMTC 事件回调已成功注册");
            }
            Err(e) => error!("创建回调对象失败: {e:?}"),
        },
        Err(e) => error!("注册回调时锁中毒: {e:?}"),
    }
}

#[instrument]
pub fn unregister_event_callback() {
    match GLOBAL_CALLBACK.lock() {
        Ok(mut guard) => {
            *guard = None;
        }
        Err(e) => {
            warn!("清理 SMTC 回调时锁中毒");
            let mut guard = e.into_inner();
            *guard = None;
        }
    }
}

#[instrument]
fn dispatch_event(event: &SmtcEvent) {
    debug!(?event, "分发 SMTC 事件");

    let event_json = match serde_json::to_string(&event) {
        Ok(json) => json,
        Err(e) => {
            error!("序列化SMTC事件失败: {e}");
            return;
        }
    };

    let maybe_v8_ctx = if let Ok(guard) = GLOBAL_CALLBACK.lock() {
        guard.as_ref().map(|cb| cb.v8_context.clone())
    } else {
        error!("SMTC 事件回调锁毒化");
        return;
    };

    if let Some(v8_ctx) = maybe_v8_ctx {
        let post_result = renderer_post_task_in_v8_ctx(v8_ctx, move || {
            let Ok(guard) = GLOBAL_CALLBACK.lock() else {
                error!("SMTC 事件回调锁在任务中毒化");
                return;
            };

            if let Some(cb) = guard.as_ref() {
                if !cb.v8_context.is_valid() || !cb.v8_function.is_valid() {
                    warn!("试图派发 SMTC 事件，但 V8 上下文或回调函数已失效");
                    return;
                }

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
pub fn initialize() -> Result<SmtcContext> {
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
        is_enabled: false,
    };

    debug!("SMTC 已初始化");
    Ok(context)
}

#[instrument]
pub fn update_play_state(ctx: &SmtcContext, status: PlaybackStatus) -> Result<()> {
    if !ctx.is_enabled {
        return Ok(());
    }

    let win_status = match status {
        PlaybackStatus::Playing => MediaPlaybackStatus::Playing,
        PlaybackStatus::Paused => MediaPlaybackStatus::Paused,
    };

    let smtc = ctx.smtc()?;
    smtc.SetPlaybackStatus(win_status)?;
    debug!(?status, "SMTC 播放状态已更新");
    Ok(())
}

#[instrument]
pub fn update_timeline(ctx: &SmtcContext, current_ms: f64, total_ms: f64) -> Result<()> {
    if !ctx.is_enabled {
        return Ok(());
    }

    let props = SystemMediaTransportControlsTimelineProperties::new()?;
    props.SetStartTime(TimeSpan { Duration: 0 })?;
    props.SetPosition(TimeSpan {
        Duration: (current_ms * HNS_PER_MILLISECOND) as i64,
    })?;
    props.SetEndTime(TimeSpan {
        Duration: (total_ms * HNS_PER_MILLISECOND) as i64,
    })?;

    let smtc = ctx.smtc()?;
    smtc.UpdateTimelineProperties(&props)?;
    Ok(())
}

#[instrument]
pub fn update_play_mode(
    ctx: &SmtcContext,
    is_shuffling: bool,
    repeat_mode: &RepeatMode,
) -> Result<()> {
    if !ctx.is_enabled {
        return Ok(());
    }

    let smtc = ctx.smtc()?;
    smtc.SetShuffleEnabled(is_shuffling)?;

    let repeat_mode_win = match repeat_mode {
        RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
        RepeatMode::List => MediaPlaybackAutoRepeatMode::List,
        RepeatMode::None | RepeatMode::AI => MediaPlaybackAutoRepeatMode::None,
    };
    smtc.SetAutoRepeatMode(repeat_mode_win)?;
    Ok(())
}

fn create_cover_stream_ref(cover: Option<&CoverSource>) -> Option<RandomAccessStreamReference> {
    match cover {
        None => {
            warn!("未提供封面, 将清空现有封面");
            None
        }
        Some(CoverSource::Base64(base64_data)) => {
            debug!("正在从 Base64 数据解码封面");
            let start_time = Instant::now();

            let bytes = match general_purpose::STANDARD.decode(base64_data) {
                Ok(b) => {
                    let elapsed = start_time.elapsed();
                    debug!(duration = ?elapsed, "封面 Base64 解码完成");
                    b
                }
                Err(e) => {
                    warn!("解码封面 Base64 失败: {e}");
                    return None;
                }
            };

            let stream_result: windows::core::Result<RandomAccessStreamReference> = (|| {
                let stream = InMemoryRandomAccessStream::new()?;
                let writer = DataWriter::CreateDataWriter(&stream)?;
                writer.WriteBytes(&bytes)?;
                writer.StoreAsync()?.join()?;
                writer.DetachStream()?;
                stream.Seek(0)?;
                RandomAccessStreamReference::CreateFromStream(&stream)
            })(
            );

            match stream_result {
                Ok(stream_ref) => Some(stream_ref),
                Err(e) => {
                    error!("创建封面内存流失败: {e:?}");
                    None
                }
            }
        }
        Some(CoverSource::Url(url)) => {
            debug!("正在从 URL 创建封面引用: {url}");
            let uri = match Uri::CreateUri(&HSTRING::from(url)) {
                Ok(u) => u,
                Err(e) => {
                    warn!("创建 URI 失败 ({url}): {e}");
                    return None;
                }
            };

            match RandomAccessStreamReference::CreateFromUri(&uri) {
                Ok(stream_ref) => Some(stream_ref),
                Err(e) => {
                    warn!("从 URI 创建流引用失败: {e}");
                    None
                }
            }
        }
    }
}

#[instrument]
pub fn update_metadata(ctx: &SmtcContext, payload: &MetadataPayload) -> Result<()> {
    if !ctx.is_enabled {
        return Ok(());
    }

    info!(
        title = %payload.song_name,
        artist = %payload.author_name,
        album = %payload.album_name,
        ncm_id = ?payload.ncm_id,
        "正在更新 SMTC 歌曲元数据"
    );

    let thumbnail_stream_ref = create_cover_stream_ref(payload.cover.as_ref());

    let smtc = ctx.smtc()?;
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
}

pub fn set_enabled(ctx: &mut SmtcContext, enabled: bool) -> Result<()> {
    ctx.is_enabled = enabled;
    let smtc = ctx.smtc()?;
    smtc.SetIsEnabled(enabled)?;

    if !enabled {
        unregister_event_callback();
    }

    Ok(())
}
