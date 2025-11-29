export type PlaybackStatus = "Playing" | "Paused";

export type CoverSource =
	| { type: "Url"; value: string }
	| { type: "Base64"; value: string };

export interface SongInfo {
	songName: string;
	albumName: string;
	authorName: string;
	cover: CoverSource | null;
	/**
	 * 原始封面 URL
	 *
	 * 用于 Discord RPC 等场景
	 */
	originalCoverUrl?: string | undefined;
	/**
	 * 歌曲ID，可用于精确匹配歌曲
	 *
	 * 后端会把 ID 拼接为 `NCM-{ID}` 并上传到 SMTC 的流派字段
	 */
	ncmId: number;
	/**
	 * 单位毫秒
	 */
	duration?: number | undefined;
}

export interface TimelineInfo {
	currentTime: number;
	totalTime: number;
}

export interface VolumeInfo {
	volume: number;
	isMuted: boolean;
}

export type ControlMessage =
	| { type: "Play" }
	| { type: "Pause" }
	| { type: "Stop" }
	| { type: "NextSong" }
	| { type: "PreviousSong" }
	| { type: "Seek"; position: number }
	| { type: "ToggleShuffle" }
	| { type: "ToggleRepeat" }
	| { type: "SetRepeat"; mode: RepeatMode }
	| { type: "SetVolume"; level: number }
	| { type: "ToggleMute" };

export type SmtcEvent =
	| { type: "Play" }
	| { type: "Pause" }
	| { type: "Stop" }
	| { type: "NextSong" }
	| { type: "PreviousSong" }
	| { type: "ToggleShuffle" }
	| { type: "ToggleRepeat" }
	| { type: "Seek"; position_ms: number };

export interface MetadataPayload extends SongInfo {}
export interface PlayStatePayload {
	status: PlaybackStatus;
}
export interface TimelinePayload {
	currentTime: number;
	totalTime: number;
}

export type RepeatMode = "None" | "Track" | "List" | "AI";

export interface PlayMode {
	isShuffling: boolean;
	repeatMode: RepeatMode;
}

export interface PlayModePayload extends PlayMode {}
export interface VolumePayload extends VolumeInfo {}

export type SmtcCommandPayloads = {
	Metadata: MetadataPayload;
	PlayState: PlayStatePayload;
	Timeline: TimelinePayload;
	PlayMode: PlayModePayload;
	Volume: VolumePayload;
	EnableSmtc: undefined;
	DisableSmtc: undefined;

	EnableDiscordRpc: undefined;
	DisableDiscordRpc: undefined;
};

export type CommandResult = {
	status: "Success" | "Error";
	message?: string;
};

export type LogEntry = {
	level: "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE";
	message: string;
	target: string;
};

export interface InfLinkEventMap {
	songChange: CustomEvent<SongInfo>;
	playStateChange: CustomEvent<PlaybackStatus>;
	timelineUpdate: CustomEvent<TimelineInfo>;
	rawTimelineUpdate: CustomEvent<TimelineInfo>;
	playModeChange: CustomEvent<PlayMode>;
	volumeChange: CustomEvent<VolumeInfo>;
}
