use base64::{Engine as _, engine::general_purpose::STANDARD};
use env_logger::Env;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::{mem::transmute, sync::mpsc::TryRecvError, thread, time::Duration};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::broadcast,
    time::{Duration as TokioDuration, sleep},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use windows::{
    Foundation::TypedEventHandler,
    Media::{
        AutoRepeatModeChangeRequestedEventArgs, MediaPlaybackAutoRepeatMode, MediaPlaybackStatus,
        MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        ShuffleEnabledChangeRequestedEventArgs, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    },
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::HBRUSH,
        System::{
            Com::{COINIT_APARTMENTTHREADED, CoInitializeEx},
            LibraryLoader::GetModuleHandleW,
            WinRT::ISystemMediaTransportControlsInterop,
        },
        UI::{
            Shell::SetCurrentProcessExplicitAppUserModelID,
            WindowsAndMessaging::{
                CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, CreateWindowExW, DefWindowProcW,
                DispatchMessageW, HCURSOR, HICON, MSG, PM_REMOVE, PeekMessageW, RegisterClassW,
                TranslateMessage, WNDCLASSW, WS_OVERLAPPEDWINDOW,
            },
        },
    },
    core::{Error, HSTRING, PCWSTR, Ref, Result as WinResult, w},
};

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "event")]
enum OutgoingEvent {
    ButtonPressed { button: String },
    SeekRequested { position_sec: f64 },
}

#[derive(Serialize, Deserialize, Debug)]
struct SongData {
    title: String,
    artist: String,
    album: String,
    thumbnail_base64: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct PlayModeData {
    is_shuffling: bool,
    // "None", "Track", "List"
    repeat_mode: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "command", content = "data")]
#[allow(clippy::enum_variant_names)]
enum IpcCommand {
    UpdateMetadata(SongData),
    UpdateStatus(i32),
    UpdateTimeline { current: f64, total: f64 },
    UpdatePlayMode(PlayModeData),
}

fn smtc_thread_main(
    command_receiver: std::sync::mpsc::Receiver<IpcCommand>,
    event_sender: broadcast::Sender<OutgoingEvent>,
) -> WinResult<()> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };

    let netease_aumid = w!("cloudmusic.exe");
    unsafe {
        if let Err(e) = SetCurrentProcessExplicitAppUserModelID(netease_aumid) {
            warn!("设置 AUMID 失败。错误: {e}");
        } else {
            info!("成功设置进程 AUMID。");
        }
    }

    let hwnd: HWND = unsafe {
        let instance = GetModuleHandleW(None)?;
        let class_name = w!("RustSmtcProxyWindow");

        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: transmute::<
                *const (),
                Option<unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT>,
            >(DefWindowProcW as *const ()),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance.into(),
            hIcon: HICON::default(),
            hCursor: HCURSOR::default(),
            hbrBackground: HBRUSH::default(),
            lpszMenuName: PCWSTR::null(),
            lpszClassName: class_name,
        };

        RegisterClassW(&wc);

        CreateWindowExW(
            Default::default(),
            class_name,
            w!("Rust SMTC Proxy"),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            None,
            None,
            Some(instance.into()),
            None,
        )?
    };

    if hwnd.0.is_null() {
        error!("创建窗口失败。程序退出。");
        return Err(Error::from(windows::Win32::Foundation::E_FAIL));
    }
    debug!("创建代理窗口，句柄: {hwnd:?}");

    let interop = windows::core::factory::<
        SystemMediaTransportControls,
        ISystemMediaTransportControlsInterop,
    >()?;
    let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };

    smtc.SetIsEnabled(true)?;
    smtc.SetPlaybackStatus(MediaPlaybackStatus::Paused)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;
    smtc.SetShuffleEnabled(false)?;
    smtc.SetAutoRepeatMode(MediaPlaybackAutoRepeatMode::None)?;

    let updater = smtc.DisplayUpdater()?;
    updater.SetType(MediaPlaybackType::Music)?;

    let button_event_sender_clone = event_sender.clone();
    let button_handler = TypedEventHandler::new(
        move |_sender: Ref<'_, SystemMediaTransportControls>,
              args: Ref<'_, SystemMediaTransportControlsButtonPressedEventArgs>|
              -> WinResult<()> {
            if let Some(event_args) = args.as_ref() {
                let button = match event_args.Button()? {
                    SystemMediaTransportControlsButton::Play => "Play",
                    SystemMediaTransportControlsButton::Pause => "Pause",
                    SystemMediaTransportControlsButton::Next => "NextSong",
                    SystemMediaTransportControlsButton::Previous => "PreviousSong",
                    _ => "Unknown",
                };

                if button != "Unknown" {
                    info!("按下按钮: {button}");
                    let event = OutgoingEvent::ButtonPressed {
                        button: button.to_string(),
                    };
                    if button_event_sender_clone.send(event).is_err() {
                        warn!("按钮按下事件没有活动的 receivers。");
                    }
                }
            }
            Ok(())
        },
    );

    let seek_event_sender_clone = event_sender.clone();
    let seek_handler = TypedEventHandler::new(
        move |_sender: Ref<'_, SystemMediaTransportControls>,
              args: Ref<'_, PlaybackPositionChangeRequestedEventArgs>|
              -> WinResult<()> {
            if let Some(event_args) = args.as_ref() {
                let position: Duration = event_args.RequestedPlaybackPosition()?.into();
                let position_sec = position.as_secs_f64();
                info!("跳转到: {position_sec:.2}s");
                let event = OutgoingEvent::SeekRequested { position_sec };
                if seek_event_sender_clone.send(event).is_err() {
                    warn!("跳转请求事件没有活动的 receivers。");
                }
            }
            Ok(())
        },
    );

    let shuffle_event_sender_clone = event_sender.clone();
    let shuffle_handler = TypedEventHandler::new(
        move |_sender: Ref<'_, SystemMediaTransportControls>,
              _args: Ref<'_, ShuffleEnabledChangeRequestedEventArgs>|
              -> WinResult<()> {
            info!("切换随机播放模式");
            let event = OutgoingEvent::ButtonPressed {
                button: "ToggleShuffle".to_string(),
            };
            if shuffle_event_sender_clone.send(event).is_err() {
                warn!("切换随机播放事件没有活动的 receivers。");
            }
            Ok(())
        },
    );

    let repeat_event_sender_clone = event_sender.clone();
    let repeat_handler = TypedEventHandler::new(
        move |_sender: Ref<'_, SystemMediaTransportControls>,
              _args: Ref<'_, AutoRepeatModeChangeRequestedEventArgs>|
              -> WinResult<()> {
            info!("切换循环模式");
            let event = OutgoingEvent::ButtonPressed {
                button: "ToggleRepeat".to_string(),
            };
            if repeat_event_sender_clone.send(event).is_err() {
                warn!("切换循环模式事件没有活动的 receivers。");
            }
            Ok(())
        },
    );

    let button_pressed_token = smtc.ButtonPressed(&button_handler)?;
    let seek_requested_token = smtc.PlaybackPositionChangeRequested(&seek_handler)?;
    let shuffle_requested_token = smtc.ShuffleEnabledChangeRequested(&shuffle_handler)?;
    let repeat_requested_token = smtc.AutoRepeatModeChangeRequested(&repeat_handler)?;

    loop {
        match command_receiver.try_recv() {
            Ok(command) => {
                info!("收到命令: {command:?}");
                match command {
                    IpcCommand::UpdatePlayMode(data) => {
                        debug!(
                            "正在更新播放模式: 随机播放={}, 重复模式={}",
                            data.is_shuffling, data.repeat_mode
                        );
                        if let Err(e) = smtc.SetShuffleEnabled(data.is_shuffling) {
                            error!("设置随机播放状态失败: {e}");
                        }
                        let repeat_mode = match data.repeat_mode.as_str() {
                            "Track" => MediaPlaybackAutoRepeatMode::Track,
                            "List" => MediaPlaybackAutoRepeatMode::List,
                            _ => MediaPlaybackAutoRepeatMode::None,
                        };
                        if let Err(e) = smtc.SetAutoRepeatMode(repeat_mode) {
                            error!("设置重复播放模式失败: {e}");
                        }
                    }
                    IpcCommand::UpdateMetadata(ref data) => {
                        // 将多个可能失败的操作组合在一起
                        let result = (|| {
                            let props = updater.MusicProperties()?;
                            props.SetTitle(&HSTRING::from(data.title.clone()))?;
                            props.SetArtist(&HSTRING::from(data.artist.clone()))?;
                            props.SetAlbumTitle(&HSTRING::from(data.album.clone()))?;
                            if let Some(base64_content) =
                                data.thumbnail_base64.split(',').next_back()
                            {
                                if let Ok(bytes) = STANDARD.decode(base64_content) {
                                    let stream = InMemoryRandomAccessStream::new()?;
                                    let writer = DataWriter::CreateDataWriter(&stream)?;
                                    writer.WriteBytes(&bytes)?;
                                    writer.StoreAsync()?;
                                    writer.DetachStream()?;
                                    stream.Seek(0)?;
                                    let stream_ref =
                                        RandomAccessStreamReference::CreateFromStream(&stream)?;
                                    updater.SetThumbnail(&stream_ref)?;
                                } else {
                                    warn!("无法解码 Base64 封面图像");
                                }
                            }
                            updater.Update()?;
                            Ok::<(), Error>(())
                        })();
                        if let Err(e) = result {
                            error!("更新元数据失败: {e}");
                        }
                    }
                    IpcCommand::UpdateStatus(status_code) => {
                        let status = match status_code {
                            3 => MediaPlaybackStatus::Playing,
                            4 => MediaPlaybackStatus::Paused,
                            _ => MediaPlaybackStatus::Closed,
                        };
                        if let Err(e) = smtc.SetPlaybackStatus(status) {
                            error!("更新播放状态失败: {e}");
                        }
                    }
                    IpcCommand::UpdateTimeline { current, total } => {
                        let result = (|| {
                            let timeline_props =
                                windows::Media::SystemMediaTransportControlsTimelineProperties::new()?;
                            timeline_props.SetStartTime(Duration::from_secs(0).into())?;
                            timeline_props
                                .SetPosition(Duration::from_millis(current as u64).into())?;
                            timeline_props
                                .SetEndTime(Duration::from_millis(total as u64).into())?;
                            smtc.UpdateTimelineProperties(&timeline_props)?;
                            Ok::<(), Error>(())
                        })();
                        if let Err(e) = result {
                            error!("更新时间线属性失败: {e}");
                        }
                    }
                }
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {
                info!("命令通道已关闭，SMTC 线程退出。");
                break;
            }
        }

        unsafe {
            let mut msg = MSG::default();
            if PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        thread::sleep(Duration::from_millis(10));
    }

    // 清理 Tokens
    smtc.RemoveButtonPressed(button_pressed_token)?;
    smtc.RemovePlaybackPositionChangeRequested(seek_requested_token)?;
    smtc.RemoveShuffleEnabledChangeRequested(shuffle_requested_token)?;
    smtc.RemoveAutoRepeatModeChangeRequested(repeat_requested_token)?;

    Ok(())
}

async fn handle_connection(
    stream: TcpStream,
    command_sender: std::sync::mpsc::Sender<IpcCommand>,
    mut event_receiver: broadcast::Receiver<OutgoingEvent>,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(s) => s,
        Err(e) => {
            error!("接受 WebSocket 连接失败: {e}");
            return;
        }
    };
    info!("新客户端已连接!");

    let (mut write, mut read) = ws_stream.split();

    loop {
        tokio::select! {
            Some(msg) = read.next() => {
                match msg {
                    Ok(Message::Text(text)) => {
                        debug!("收到原始 Websocket 文本: {text}");
                        match serde_json::from_str::<IpcCommand>(&text) {
                            Ok(cmd) => {
                                debug!("收到 IPC 命令: {cmd:?}");
                                if command_sender.send(cmd).is_err() {
                                    error!("向 SMTC 线程发送命令失败，线程可能已退出。");
                                    break;
                                }
                            }
                            Err(e) => {
                                warn!("无法将文本解析为 IpcCommand: {e}, 原始文本: '{text}'");
                            }
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Err(e) => {
                        warn!("WebSocket 读取错误: {e}");
                        break;
                    }
                    _ => {}
                }
            },
            Ok(event) = event_receiver.recv() => {
                debug!("收到事件，准备发送: {:?}", &event);
                if let Ok(json) = serde_json::to_string(&event)
                    && write.send(Message::Text(json.into())).await.is_err() {
                        // 发送失败意味着客户端已断开
                        break;
                    }
            }
        }
    }
    info!("客户端已断开连接。");
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(Env::default().default_filter_or("info")).init();

    let (command_sender, command_receiver) = std::sync::mpsc::channel::<IpcCommand>();
    let (event_sender, _) = broadcast::channel::<OutgoingEvent>(32);

    let event_sender_clone = event_sender.clone();
    thread::spawn(move || {
        if let Err(e) = smtc_thread_main(command_receiver, event_sender_clone) {
            error!("SMTC 线程已 panic: {e}");
        }
    });

    let addr = "127.0.0.1:9001";
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("无法绑定到地址 {addr}: {e}");
            return;
        }
    };
    info!("正在监听 ws://{addr}");

    let connection_timeout = TokioDuration::from_secs(15);

    info!(
        "等待 WebSocket 连接... 超时时间: {} 秒",
        connection_timeout.as_secs()
    );

    tokio::select! {
        Ok((stream, peer_addr)) = listener.accept() => {
            info!("接受来自 {peer_addr} 的新连接");
            let cmd_sender_clone = command_sender.clone();
            let evt_receiver_clone = event_sender.subscribe();

            let handle = tokio::spawn(handle_connection(
                stream,
                cmd_sender_clone,
                evt_receiver_clone,
            ));

            if let Err(e) = handle.await {
                error!("连接处理任务出现错误: {e}");
            }
        }
        _ = sleep(connection_timeout) => {
            info!("在 {} 秒内没有连接，正在退出。", connection_timeout.as_secs());
        }
    }
}
