use std::{
    fmt,
    ops::Deref,
    sync::Arc,
};

use serde::{
    Deserialize,
    Serialize,
};

#[derive(Debug, Clone, PartialEq)]
pub struct SharedMetadata(pub Arc<MetadataPayload>);

impl Deref for SharedMetadata {
    type Target = MetadataPayload;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AsRef<MetadataPayload> for SharedMetadata {
    fn as_ref(&self) -> &MetadataPayload {
        &self.0
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum AppMessage {
    UpdateMetadata(MetadataUpdate),

    UpdatePlayState(PlayStatePayload),
    UpdateTimeline(TimelinePayload),
    UpdatePlayMode(PlayModePayload),

    EnableSmtc,
    DisableSmtc,

    EnableDiscord,
    DisableDiscord,
    DiscordConfig(DiscordConfigPayload),

    Shutdown,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
pub struct CoverPayload {
    /// 封面地址。只有在二进制通道没送成时才会用到 (后端直接按这个地址取图)
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataPayload {
    pub song_name: String,
    pub author_name: String,
    pub album_name: String,
    pub cover: Option<CoverPayload>,
    pub ncm_id: Option<u64>,
    pub duration: Option<f64>,
}

/// 一次元数据更新命令
///
/// 除了前端送来的元数据, 它还带着封面二进制数据: 前端用
/// `inflink.dispatchWithArrayBuffer` 在同一次调用里把字节和命令一起交过来,
/// `dispatcher::send_command` 会把字节挂到这个字段上 (详见 `array_buffer` 模块),
/// 让它跟着命令一起跨线程送到 dispatcher。
#[derive(Deserialize, Serialize, Clone, PartialEq)]
pub struct MetadataUpdate {
    #[serde(flatten)]
    pub payload: MetadataPayload,

    /// 封面原始字节, 只由后端内部填充, 前端不会传
    #[serde(default, skip_serializing)]
    pub cover_bytes: Option<Vec<u8>>,
}

impl fmt::Debug for MetadataUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MetadataUpdate")
            .field("payload", &self.payload)
            .field("cover_bytes", &self.cover_bytes.as_ref().map(Vec::len))
            .finish()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackStatus {
    Playing,
    Paused,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum RepeatMode {
    None,
    Track,
    List,
    AI,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlayStatePayload {
    pub status: PlaybackStatus,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePayload {
    pub current_time: f64,
    pub total_time: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlayModePayload {
    pub is_shuffling: bool,
    pub repeat_mode: RepeatMode,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscordConfigPayload {
    pub show_when_paused: bool,
    pub display_mode: Option<DiscordDisplayMode>,
    #[serde(default)]
    pub app_name_mode: DiscordAppNameMode,
}

#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "type", content = "value")]
pub enum DiscordAppNameMode {
    #[default]
    Default,
    Song,
    Artist,
    Album,
    Custom(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum DiscordDisplayMode {
    Name,    // Listening to Spotify
    State,   // Listening to Rick Astley
    Details, // Listening to Never Gonna Give You Up
}

#[derive(Serialize, Debug)]
pub enum CommandStatus {
    Success,
    Error,
}

#[derive(Serialize, Debug)]
pub struct CommandResult {
    pub status: CommandStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
