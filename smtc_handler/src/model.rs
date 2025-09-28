use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
#[serde(tag = "type", content = "payload")]
pub enum SmtcCommand {
    Metadata(MetadataPayload),
    PlayState(PlayStatePayload),
    Timeline(TimelinePayload),
    PlayMode(PlayModePayload),
}

#[derive(Deserialize, Serialize)]
pub struct MetadataPayload {
    #[serde(rename = "songName")]
    pub song_name: String,
    #[serde(rename = "authorName")]
    pub author_name: String,
    #[serde(rename = "albumName")]
    pub album_name: String,
    #[serde(rename = "thumbnail_base64")]
    pub thumbnail_base64: String,
}

impl fmt::Debug for MetadataPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut debug_struct = f.debug_struct("MetadataPayload");

        debug_struct.field("song_name", &self.song_name);
        debug_struct.field("author_name", &self.author_name);
        debug_struct.field("album_name", &self.album_name);

        if self.thumbnail_base64.is_empty() {
            debug_struct.field("thumbnail_base64", &"<empty>");
        } else {
            debug_struct.field(
                "thumbnail_base64",
                &format_args!("<已省略... 长度:{}>", self.thumbnail_base64.len()),
            );
        }

        debug_struct.finish()
    }
}

#[derive(Deserialize, Debug)]
pub enum PlaybackStatus {
    Playing,
    Paused,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum RepeatMode {
    None,
    Track,
    List,
}

#[derive(Deserialize, Debug)]
pub struct PlayStatePayload {
    pub status: PlaybackStatus,
}

#[derive(Deserialize, Debug)]
pub struct TimelinePayload {
    #[serde(rename = "currentTime")]
    pub current_time: f64,
    #[serde(rename = "totalTime")]
    pub total_time: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayModePayload {
    pub is_shuffling: bool,
    pub repeat_mode: RepeatMode,
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
