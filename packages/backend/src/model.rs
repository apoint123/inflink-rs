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
    UpdateMetadata(MetadataPayload),

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

#[derive(Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(tag = "type", content = "value")]
pub enum CoverSource {
    Url(String),
    Base64(String),
}

impl fmt::Debug for CoverSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Url(url) => f.debug_tuple("Url").field(url).finish(),
            Self::Base64(_) => f.debug_tuple("Base64").field(&"<...omitted...>").finish(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataPayload {
    pub song_name: String,
    pub author_name: String,
    pub album_name: String,
    pub cover: Option<CoverSource>,
    pub original_cover_url: Option<String>,
    pub ncm_id: Option<u64>,
    pub duration: Option<f64>,
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
