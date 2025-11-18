use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{Activity, ActivityType, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use tracing::{debug, info, warn};

use crate::model::{MetadataPayload, PlayStatePayload, PlaybackStatus, TimelinePayload};

const APP_ID: &str = "1427186361827594375";

// 主要用来应对跳转进度的更新
const TIMESTAMP_UPDATE_THRESHOLD_MS: i64 = 100;
const RECONNECT_COOLDOWN_SECONDS: u8 = 5;

enum RpcMessage {
    Metadata(MetadataPayload),
    PlayState(PlayStatePayload),
    Timeline(TimelinePayload),
    Enable,
    Disable,
}

static SENDER: LazyLock<Mutex<Option<Sender<RpcMessage>>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, PartialEq)]
struct ActivityData {
    metadata: MetadataPayload,
    status: PlaybackStatus,
    current_time: f64,
}

impl ActivityData {
    const fn from_metadata(metadata: MetadataPayload) -> Self {
        Self {
            metadata,
            status: PlaybackStatus::Paused,
            current_time: 0.0,
        }
    }
}

struct RpcWorker {
    client: Option<DiscordIpcClient>,
    data: Option<ActivityData>,
    is_enabled: bool,
    connect_retry_count: u8,
    // 上次发送的结束时间戳
    // 用于防抖，也用于判断是否要清除 Activity
    last_sent_end_timestamp: Option<i64>,
}

impl RpcWorker {
    const fn new() -> Self {
        Self {
            client: None,
            data: None,
            is_enabled: false,
            connect_retry_count: 0,
            last_sent_end_timestamp: None,
        }
    }

    fn handle_message(&mut self, msg: RpcMessage) {
        match msg {
            RpcMessage::Enable => {
                info!("启用 Discord RPC");
                self.is_enabled = true;
                self.connect_retry_count = 0;
            }
            RpcMessage::Disable => {
                info!("禁用 Discord RPC");
                self.is_enabled = false;
                self.disconnect();
            }
            RpcMessage::Metadata(payload) => {
                let new_data = match self.data.take() {
                    Some(mut d) => {
                        d.metadata = payload;
                        d.current_time = 0.0;
                        d
                    }
                    None => ActivityData::from_metadata(payload),
                };
                self.data = Some(new_data);
                self.last_sent_end_timestamp = None;
            }
            RpcMessage::PlayState(payload) => {
                if let Some(data) = &mut self.data {
                    if payload.status == PlaybackStatus::Playing
                        && data.status != PlaybackStatus::Playing
                    {
                        self.last_sent_end_timestamp = None;
                    }
                    data.status = payload.status;
                }
            }
            RpcMessage::Timeline(payload) => {
                if let Some(data) = &mut self.data {
                    data.current_time = payload.current_time;
                }
            }
        }
    }

    fn disconnect(&mut self) {
        if let Some(mut client) = self.client.take() {
            let _ = client.close();
        }
        self.last_sent_end_timestamp = None;
    }

    fn connect(&mut self) {
        if self.connect_retry_count > 0 {
            self.connect_retry_count -= 1;
            return;
        }

        let mut client = DiscordIpcClient::new(APP_ID);
        match client.connect() {
            Ok(()) => {
                info!("Discord IPC 已连接");
                self.client = Some(client);
                self.last_sent_end_timestamp = None;
            }
            Err(e) => {
                info!("连接 Discord IPC 失败: {e:?}. Discord 可能未运行");
                self.connect_retry_count = RECONNECT_COOLDOWN_SECONDS;
            }
        }
    }

    fn sync_discord(&mut self) {
        if !self.is_enabled {
            if self.client.is_some() {
                self.disconnect();
            }
            return;
        }

        if self.data.is_none() {
            if let Some(client) = &mut self.client {
                let _ = client.clear_activity();
                self.last_sent_end_timestamp = None;
            }
            return;
        }

        if self.client.is_none() {
            self.connect();
        }

        if let (Some(client), Some(data)) = (&mut self.client, &self.data) {
            let success = Self::perform_update(client, data, &mut self.last_sent_end_timestamp);
            if !success {
                self.disconnect();
            }
        }
    }

    fn perform_update(
        client: &mut DiscordIpcClient,
        data: &ActivityData,
        last_sent_end_timestamp: &mut Option<i64>,
    ) -> bool {
        if matches!(data.status, PlaybackStatus::Paused) {
            if last_sent_end_timestamp.is_some() {
                // Discord 会自己推动进度条，我们没法让进度条停下来
                // 所以只能直接移除 Activity 了，或者找个办法把进度定在 0
                debug!("播放暂停，清除 Activity");
                if let Err(e) = client.clear_activity() {
                    warn!("清除 Activity 失败: {e:?}");
                    return false;
                }
                *last_sent_end_timestamp = None;
            }
            return true;
        }

        let metadata = &data.metadata;

        let large_image = metadata.original_cover_url.as_deref().map_or_else(
            || "ncm_icon".to_string(),
            |url| {
                let url = url.replace("http://", "https://");
                // 通常不会出现查询参数
                let base_url = url.split('?').next().unwrap_or(&url);
                format!("{base_url}?imageView&enlarge=1&type=jpeg&quality=90&thumbnail=150y150")
            },
        );

        let assets = Assets::new()
            .large_image(&large_image)
            .large_text(&metadata.album_name)
            .small_image("ncm_icon")
            .small_text("NetEase CloudMusic");

        let song_url = metadata.ncm_id.map_or_else(
            || "https://music.163.com/".to_string(),
            |ncm_id| format!("https://music.163.com/song?id={ncm_id}"),
        );

        let buttons = vec![Button::new("🎧 Listen", &song_url)];

        let mut activity = Activity::new()
            .details(&metadata.song_name)
            .state(&metadata.author_name)
            .activity_type(ActivityType::Listening)
            .assets(assets)
            .buttons(buttons);

        let mut should_update = true;

        if let Some(duration) = metadata.duration
            && duration > 0.0
        {
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let duration_ms = duration as i64;
            let current_time_ms = data.current_time as i64;
            let remaining_ms = (duration_ms - current_time_ms).max(0);

            let end = now_ms + remaining_ms;
            let start = end - duration_ms;

            // 频繁调用 Discord RPC 接口似乎会导致限流，所以在跳转发生时再更新时间戳
            if let Some(last_end) = last_sent_end_timestamp {
                let diff = (*last_end - end).abs();
                if diff < TIMESTAMP_UPDATE_THRESHOLD_MS {
                    should_update = false;
                } else {
                    debug!("进度偏差 {}ms >= 阈值. 需要更新", diff);
                }
            }

            if should_update {
                activity = activity.timestamps(Timestamps::new().start(start).end(end));
                *last_sent_end_timestamp = Some(end);
            }
        } else {
            should_update = last_sent_end_timestamp.is_some();
            *last_sent_end_timestamp = None;
        }

        if !should_update {
            return true;
        }

        debug!(data = ?metadata, "更新 Discord Activity");

        if let Err(e) = client.set_activity(activity) {
            warn!("设置 Discord Activity 失败: {e:?}, 尝试重连");
            return false;
        }

        true
    }
}

fn background_loop(rx: &Receiver<RpcMessage>) {
    let mut worker = RpcWorker::new();

    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(msg) => {
                worker.handle_message(msg);
                worker.sync_discord();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if worker.client.is_none() {
                    worker.sync_discord();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

pub fn init() {
    let (tx, rx) = mpsc::channel();
    if let Ok(mut guard) = SENDER.lock() {
        *guard = Some(tx);
    }
    thread::spawn(move || {
        background_loop(&rx);
    });
}

fn send(msg: RpcMessage) {
    if let Ok(guard) = SENDER.lock()
        && let Some(tx) = guard.as_ref()
    {
        let _ = tx.send(msg);
    }
}

pub fn enable() {
    send(RpcMessage::Enable);
}
pub fn disable() {
    send(RpcMessage::Disable);
}
pub fn update_metadata(payload: MetadataPayload) {
    send(RpcMessage::Metadata(payload));
}
pub fn update_play_state(payload: PlayStatePayload) {
    send(RpcMessage::PlayState(payload));
}
pub fn update_timeline(payload: TimelinePayload) {
    send(RpcMessage::Timeline(payload));
}
