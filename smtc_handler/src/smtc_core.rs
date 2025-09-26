use base64::{Engine as _, engine::general_purpose::STANDARD};
use cef_safe::{CefV8Context, CefV8Value, renderer_post_task_in_v8_ctx};
use log::error;
use serde::Serialize;
use std::sync::{LazyLock, Mutex};
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
    core::{HSTRING, Ref, Result as WinResult},
};

struct SmtcCallback {
    v8_context: CefV8Context,
    v8_function: CefV8Value,
}
// Safety: 我们目前只是把 CefRefPtr 发送到下面的 EVENT_CALLBACK
// renderer_post_task_in_v8_ctx 确保了对这些对象的操作会在相同的线程上执行
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
    let callback = unsafe { CefV8Value::from_raw(v8_func_ptr) }.and_then(|v8_function| {
        CefV8Context::current().map(|v8_context| SmtcCallback {
            v8_function: v8_function.clone(),
            v8_context,
        })
    });

    if callback.is_some() {
        *EVENT_CALLBACK.lock().unwrap() = callback;
    }
}

pub fn unregister_event_callback() {
    EVENT_CALLBACK.lock().unwrap().take();
}

fn dispatch_event(event: SmtcEvent) {
    let event_json = match serde_json::to_string(&event) {
        Ok(json) => json,
        Err(e) => {
            error!("反序列化SMTC事件失败: {}", e);
            return;
        }
    };

    let maybe_context = match EVENT_CALLBACK.lock() {
        Ok(guard) => guard.as_ref().map(|cb| cb.v8_context.clone()),
        Err(_) => {
            error!("SMTC 事件回调锁毒化");
            return;
        }
    };

    if let Some(context) = maybe_context {
        let success = unsafe {
            renderer_post_task_in_v8_ctx(context, move || {
                let guard = match EVENT_CALLBACK.lock() {
                    Ok(g) => g,
                    Err(_) => {
                        error!("SMTC 事件回调锁在任务中毒化");
                        return;
                    }
                };

                if let Some(callback) = guard.as_ref()
                    && let Some(arg) = CefV8Value::try_from_str(&event_json)
                    && callback
                        .v8_function
                        .execute_function(None, vec![arg])
                        .is_none()
                {
                    error!("JS 回调函数执行失败");
                }
            })
        };
        if !success {
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

pub fn initialize() -> WinResult<()> {
    let player = MEDIA_PLAYER.lock().unwrap();
    let smtc = player.SystemMediaTransportControls()?;

    smtc.SetIsEnabled(true)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;

    let handler = TypedEventHandler::new(
        move |_sender: Ref<SystemMediaTransportControls>,
              args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>|
              -> WinResult<()> {
            if let Some(args) = args.as_ref() {
                let event = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => SmtcEvent::Play,
                    SystemMediaTransportControlsButton::Pause => SmtcEvent::Pause,
                    SystemMediaTransportControlsButton::Next => SmtcEvent::NextSong,
                    SystemMediaTransportControlsButton::Previous => SmtcEvent::PreviousSong,
                    _ => return Ok(()),
                };
                dispatch_event(event);
            }
            Ok(())
        },
    );
    smtc.ButtonPressed(&handler)?;

    let shuffle_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<ShuffleEnabledChangeRequestedEventArgs>|
              -> WinResult<()> {
            dispatch_event(SmtcEvent::ToggleShuffle);
            Ok(())
        },
    );
    smtc.ShuffleEnabledChangeRequested(&shuffle_handler)?;

    let repeat_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<AutoRepeatModeChangeRequestedEventArgs>|
              -> WinResult<()> {
            dispatch_event(SmtcEvent::ToggleRepeat);
            Ok(())
        },
    );
    smtc.AutoRepeatModeChangeRequested(&repeat_handler)?;

    let seek_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              args: Ref<PlaybackPositionChangeRequestedEventArgs>|
              -> WinResult<()> {
            if let Some(args) = args.as_ref() {
                let position = args.RequestedPlaybackPosition()?;
                let position_ms = (position.Duration as f64) / 10_000.0;
                dispatch_event(SmtcEvent::Seek { position_ms });
            }
            Ok(())
        },
    );
    smtc.PlaybackPositionChangeRequested(&seek_handler)?;

    log::info!("[InfLink-rs] SMTC 已初始化");
    Ok(())
}

pub fn shutdown() -> WinResult<()> {
    let player = MEDIA_PLAYER.lock().unwrap();
    let smtc = player.SystemMediaTransportControls()?;
    smtc.SetIsEnabled(false)?;
    Ok(())
}

pub fn update_play_state(status_code: i32) -> WinResult<()> {
    let player = MEDIA_PLAYER.lock().unwrap();
    let status = match status_code {
        3 => MediaPlaybackStatus::Playing,
        4 => MediaPlaybackStatus::Paused,
        _ => MediaPlaybackStatus::Closed,
    };
    player
        .SystemMediaTransportControls()?
        .SetPlaybackStatus(status)?;
    Ok(())
}

pub fn update_timeline(current_ms: f64, total_ms: f64) -> WinResult<()> {
    let player = MEDIA_PLAYER.lock().unwrap();
    let smtc = player.SystemMediaTransportControls()?;

    let props = SystemMediaTransportControlsTimelineProperties::new()?;
    props.SetStartTime(TimeSpan { Duration: 0 })?;
    props.SetPosition(TimeSpan {
        Duration: (current_ms * 10000.0) as i64,
    })?;
    props.SetEndTime(TimeSpan {
        Duration: (total_ms * 10000.0) as i64,
    })?;

    smtc.UpdateTimelineProperties(&props)?;
    Ok(())
}

pub fn update_play_mode(is_shuffling: bool, repeat_mode_str: &str) -> WinResult<()> {
    let player = MEDIA_PLAYER.lock().unwrap();
    let smtc = player.SystemMediaTransportControls()?;

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
) -> WinResult<()> {
    let player = MEDIA_PLAYER.lock().unwrap();
    let updater = player.SystemMediaTransportControls()?.DisplayUpdater()?;
    updater.SetType(MediaPlaybackType::Music)?;

    let props = updater.MusicProperties()?;
    props.SetTitle(&HSTRING::from(title))?;
    props.SetArtist(&HSTRING::from(artist))?;
    props.SetAlbumTitle(&HSTRING::from(album))?;

    if let Ok(bytes) = STANDARD.decode(thumbnail_base64) {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(&bytes)?;
        writer.StoreAsync()?.GetResults()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        let stream_ref = RandomAccessStreamReference::CreateFromStream(&stream)?;
        updater.SetThumbnail(&stream_ref)?;
    }

    updater.Update()?;
    Ok(())
}
