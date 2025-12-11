use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{Activity, ActivityType, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use tracing::{debug, info, warn};

use crate::model::{
    DiscordConfigPayload, MetadataPayload, PlayStatePayload, PlaybackStatus, TimelinePayload,
};

const APP_ID: &str = "1427186361827594375";
const NCM_ICON_ASSET_KEY: &str = "ncm_icon";

// 主要用来应对跳转进度的更新
const TIMESTAMP_UPDATE_THRESHOLD_MS: i64 = 100;
const RECONNECT_COOLDOWN_SECONDS: u8 = 5;

enum RpcMessage {
    Metadata(MetadataPayload),
    PlayState(PlayStatePayload),
    Timeline(TimelinePayload),
    Enable,
    Disable,
    Config(DiscordConfigPayload),
}

static SENDER: LazyLock<Mutex<Option<Sender<RpcMessage>>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, PartialEq)]
struct ActivityData {
    metadata: MetadataPayload,
    status: PlaybackStatus,
    current_time: f64,
    cached_cover_url: String,
    cached_song_url: String,
}

impl ActivityData {
    fn from_metadata(metadata: MetadataPayload) -> Self {
        let cached_cover_url = Self::process_cover_url(metadata.original_cover_url.as_deref());
        let cached_song_url = Self::process_song_url(metadata.ncm_id);
        Self {
            metadata,
            status: PlaybackStatus::Paused,
            current_time: 0.0,
            cached_cover_url,
            cached_song_url,
        }
    }

    fn update_metadata(&mut self, metadata: MetadataPayload) {
        self.cached_cover_url = Self::process_cover_url(metadata.original_cover_url.as_deref());
        self.cached_song_url = Self::process_song_url(metadata.ncm_id);
        self.metadata = metadata;
        self.current_time = 0.0;
    }

    fn process_cover_url(original_url: Option<&str>) -> String {
        original_url.map_or_else(
            || NCM_ICON_ASSET_KEY.to_string(),
            |url| {
                let url = url.replace("http://", "https://");
                let base_url = url.split('?').next().unwrap_or(&url);
                format!("{base_url}?imageView&enlarge=1&type=jpeg&quality=90&thumbnail=150y150")
            },
        )
    }

    fn process_song_url(ncm_id: Option<u64>) -> String {
        ncm_id.map_or_else(
            || "https://music.163.com/".to_string(),
            |id| format!("https://music.163.com/song?id={id}"),
        )
    }
}

#[derive(Debug, Default)]
struct RpcWorker {
    client: Option<DiscordIpcClient>,
    data: Option<ActivityData>,
    is_enabled: bool,
    connect_retry_count: u8,
    // 上次发送的结束时间戳
    // 用于防抖，也用于判断是否要清除 Activity
    last_sent_end_timestamp: Option<i64>,
    show_when_paused: bool,
}

impl RpcWorker {
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
            RpcMessage::Config(payload) => {
                info!(show_when_paused = ?payload.show_when_paused, "更新 Discord 配置",);
                self.show_when_paused = payload.show_when_paused;
                self.last_sent_end_timestamp = None;
            }
            RpcMessage::Metadata(payload) => {
                let new_data = match self.data.take() {
                    Some(mut d) => {
                        d.update_metadata(payload);
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
            let success = Self::perform_update(
                client,
                data,
                &mut self.last_sent_end_timestamp,
                self.show_when_paused,
            );
            if !success {
                self.disconnect();
            }
        }
    }

    fn build_base_activity(data: &ActivityData) -> Activity<'_> {
        let assets = Assets::new()
            .large_image(&data.cached_cover_url)
            .large_text(&data.metadata.album_name)
            .small_image(NCM_ICON_ASSET_KEY)
            .small_text("NetEase CloudMusic");

        let buttons = vec![Button::new("🎧 Listen", &data.cached_song_url)];

        Activity::new()
            .details(&data.metadata.song_name)
            .state(&data.metadata.author_name)
            .activity_type(ActivityType::Listening)
            .assets(assets)
            .buttons(buttons)
    }

    fn calc_paused_timestamps(current_time: f64, duration: f64) -> (i64, i64) {
        // 来自 https://musicpresence.app/ 的 hack，通过将
        // 开始和结束时间戳向后平移一年以实现在暂停时进度静止的效果
        const ONE_YEAR_S: i64 = 365 * 24 * 60 * 60;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let current_progress_ms = current_time as i64;
        let future_start = (now_ms - current_progress_ms) + ONE_YEAR_S;
        let future_end = future_start + (duration as i64);

        (future_start, future_end)
    }

    fn calc_playing_timestamps(current_time: f64, duration: f64) -> (i64, i64) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let duration_ms = duration as i64;
        let current_time_ms = current_time as i64;
        let remaining_ms = (duration_ms - current_time_ms).max(0);

        let end = now_ms + remaining_ms;
        let start = end - duration_ms;

        (start, end)
    }

    fn perform_update(
        client: &mut DiscordIpcClient,
        data: &ActivityData,
        last_sent_end_timestamp: &mut Option<i64>,
        show_when_paused: bool,
    ) -> bool {
        let mut activity = Self::build_base_activity(data);
        let mut new_end_timestamp = None;
        let should_send;

        match data.status {
            PlaybackStatus::Paused => {
                if !show_when_paused {
                    debug!("播放暂停且配置为隐藏，清除 Activity");
                    if let Err(e) = client.clear_activity() {
                        warn!("清除 Discord Activity 失败: {e:?}");
                        return false;
                    }
                    *last_sent_end_timestamp = None;
                    return true;
                }

                if let Some(duration) = data.metadata.duration
                    && duration > 0.0
                {
                    let (start, end) = Self::calc_paused_timestamps(data.current_time, duration);

                    debug!(future_start = start, future_end = end, "应用 hack 时间戳");

                    activity = activity
                        .timestamps(Timestamps::new().start(start).end(end))
                        .assets(
                            Assets::new()
                                .large_image(&data.cached_cover_url)
                                .large_text(&data.metadata.album_name)
                                .small_image(NCM_ICON_ASSET_KEY)
                                .small_text("Paused"),
                        );
                }

                should_send = true;
                *last_sent_end_timestamp = None;
            }
            PlaybackStatus::Playing => {
                if let Some(duration) = data.metadata.duration
                    && duration > 0.0
                {
                    let (start, end) = Self::calc_playing_timestamps(data.current_time, duration);

                    // 频繁调用 Discord RPC 接口会导致限流，所以在跳转发生时再更新时间戳
                    if let Some(last_end) = last_sent_end_timestamp {
                        let diff = (*last_end - end).abs();
                        if diff < TIMESTAMP_UPDATE_THRESHOLD_MS {
                            return true;
                        }
                        debug!(
                            diff_ms = diff,
                            threshold_ms = TIMESTAMP_UPDATE_THRESHOLD_MS,
                            "进度变更超过阈值，触发更新"
                        );
                    }

                    activity = activity.timestamps(Timestamps::new().start(start).end(end));
                    new_end_timestamp = Some(end);
                    should_send = true;
                } else {
                    should_send = last_sent_end_timestamp.is_some();
                    if should_send {
                        warn!("没有时长，清除时间戳");
                    }
                }
            }
        }

        if should_send {
            debug!(
                song = %data.metadata.song_name,
                state = ?data.status,
                "更新 Discord Activity"
            );

            if let Err(e) = client.set_activity(activity) {
                warn!("设置 Discord Activity 失败: {e:?}, 尝试重连");
                return false;
            }
        }

        if new_end_timestamp.is_some() {
            *last_sent_end_timestamp = new_end_timestamp;
        } else if matches!(data.status, PlaybackStatus::Playing) && data.metadata.duration.is_none()
        {
            *last_sent_end_timestamp = None;
        }

        true
    }
}

fn background_loop(rx: &Receiver<RpcMessage>) {
    let mut worker = RpcWorker::default();

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
        && let Err(e) = tx.send(msg)
    {
        warn!("向 Discord RPC 线程发送消息失败: {e}");
    }
}

pub fn enable() {
    send(RpcMessage::Enable);
}
pub fn disable() {
    send(RpcMessage::Disable);
}
pub fn update_config(payload: DiscordConfigPayload) {
    send(RpcMessage::Config(payload));
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
