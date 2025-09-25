use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::ffi::{CString, c_char};
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

static MEDIA_PLAYER: LazyLock<Mutex<MediaPlayer>> = LazyLock::new(|| {
    let player = MediaPlayer::new().expect("无法创建 MediaPlayer 实例");
    let smtc = player
        .SystemMediaTransportControls()
        .expect("无法获取 SMTC");
    smtc.SetIsEnabled(false).expect("无法禁用 SMTC");
    Mutex::new(player)
});

static EVENT_QUEUE: LazyLock<Mutex<Vec<SmtcEvent>>> = LazyLock::new(|| Mutex::new(Vec::new()));

static JSON_BUFFER: LazyLock<Mutex<CString>> =
    LazyLock::new(|| Mutex::new(CString::new("").unwrap()));

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
                EVENT_QUEUE.lock().unwrap().push(event);
            }
            Ok(())
        },
    );
    smtc.ButtonPressed(&handler)?;

    let shuffle_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<ShuffleEnabledChangeRequestedEventArgs>|
              -> WinResult<()> {
            EVENT_QUEUE.lock().unwrap().push(SmtcEvent::ToggleShuffle);
            Ok(())
        },
    );
    smtc.ShuffleEnabledChangeRequested(&shuffle_handler)?;

    let repeat_handler = TypedEventHandler::new(
        move |_: Ref<SystemMediaTransportControls>,
              _: Ref<AutoRepeatModeChangeRequestedEventArgs>|
              -> WinResult<()> {
            EVENT_QUEUE.lock().unwrap().push(SmtcEvent::ToggleRepeat);
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
                EVENT_QUEUE
                    .lock()
                    .unwrap()
                    .push(SmtcEvent::Seek { position_ms });
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
    log::info!("[InfLink-rs] SMTC 已关闭");
    Ok(())
}

pub fn poll_events() -> *const c_char {
    let mut queue = EVENT_QUEUE.lock().unwrap();
    if queue.is_empty() {
        return std::ptr::null();
    }

    let events_json = match serde_json::to_string(&*queue) {
        Ok(json) => json,
        Err(_) => return std::ptr::null(),
    };
    queue.clear();

    match CString::new(events_json) {
        Ok(c_string) => {
            let mut buffer_guard = JSON_BUFFER.lock().unwrap();
            *buffer_guard = c_string;
            buffer_guard.as_ptr()
        }
        Err(_) => std::ptr::null(),
    }
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
