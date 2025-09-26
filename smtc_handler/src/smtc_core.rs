use base64::{Engine as _, engine::general_purpose::STANDARD};
use cef_bindings::{CefBaseRefCounted, CefV8Context, CefV8Value, renderer_post_task_in_v8_ctx};
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
    _v8_function_ref: CefBaseRefCounted,
}

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

pub fn register_event_callback(v8_func_ptr: *mut cef_bindings::sys::cef_v8value_t) {
    unsafe {
        let v8_function = CefV8Value::from_raw(v8_func_ptr);
        let v8_context = CefV8Context::current();

        let base_ref = CefBaseRefCounted::from_raw(v8_func_ptr as _);
        base_ref.add_ref();

        let callback = SmtcCallback {
            v8_context,
            v8_function,
            _v8_function_ref: base_ref,
        };

        *EVENT_CALLBACK.lock().unwrap() = Some(callback);
        log::info!("[InfLink-rs] 事件回调注册成功");
    }
}

pub fn unregister_event_callback() {
    if EVENT_CALLBACK.lock().unwrap().take().is_some() {
        log::info!("[InfLink-rs] 事件回调已注销");
    }
}

fn dispatch_event(event: SmtcEvent) {
    if let Some(callback) = EVENT_CALLBACK.lock().unwrap().as_ref() {
        let event_json = serde_json::to_string(&event).unwrap();

        let context_ptr = callback.v8_context.0;
        let function_ptr = callback.v8_function.0;

        let context_addr = context_ptr as usize;
        let function_addr = function_ptr as usize;

        renderer_post_task_in_v8_ctx(context_ptr, move || unsafe {
            let func_ptr = function_addr as *mut cef_bindings::sys::cef_v8value_t;
            let ctx_ptr = context_addr as *mut cef_bindings::sys::cef_v8context_t;

            let func = CefV8Value::from_raw(func_ptr);
            let ctx = CefV8Context(ctx_ptr);

            let v8_context = ctx.0.as_mut().unwrap();
            (v8_context.enter.unwrap())(v8_context);

            let arg = CefV8Value::try_from(event_json.as_str()).unwrap();
            func.execute_function(None, &[arg]);

            (v8_context.exit.unwrap())(v8_context);
        });
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
        writer.StoreAsync()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        let stream_ref = RandomAccessStreamReference::CreateFromStream(&stream)?;
        updater.SetThumbnail(&stream_ref)?;
    }

    updater.Update()?;
    Ok(())
}
