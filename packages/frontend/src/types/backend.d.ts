import type { PlaybackStatus, PlayMode, RepeatMode, VolumeInfo } from "./api";

export type ControlMessage =
	| { type: "Play" }
	| { type: "Pause" }
	| { type: "Stop" }
	| { type: "NextSong" }
	| { type: "PreviousSong" }
	| { type: "Seek"; position_ms: number }
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

/**
 * FFI 边界使用的元数据类型，主要是 blob 转换为 base64 字符串以便跨 FFI 边界传递
 */
export interface MetadataPayload {
	songName: string;
	albumName: string;
	authorName: string;
	cover: MetadataCoverPayload | null;
	ncmId: number;
	duration?: number | undefined;
}

export interface MetadataCoverPayload {
	base64?: string | undefined;
	url?: string | undefined;
}
export interface PlayStatePayload {
	status: PlaybackStatus;
}
export interface TimelinePayload {
	currentTime: number;
	totalTime: number;
}

export interface PlayModePayload extends PlayMode {}
export interface VolumePayload extends VolumeInfo {}

export type AppMessage = {
	UpdateMetadata: MetadataPayload;
	UpdatePlayState: PlayStatePayload;
	UpdateTimeline: TimelinePayload;
	UpdatePlayMode: PlayModePayload;

	EnableSmtc: undefined;
	DisableSmtc: undefined;

	EnableDiscord: undefined;
	DisableDiscord: undefined;
	DiscordConfig: DiscordConfigPayload;
};

export type DiscordDisplayMode = "Name" | "State" | "Details";

export interface DiscordConfigPayload {
	showWhenPaused: boolean;
	displayMode: DiscordDisplayMode;
	appNameMode: DiscordAppNameMode;
}

export type DiscordAppNameMode =
	| { type: "Default" }
	| { type: "Song" }
	| { type: "Artist" }
	| { type: "Album" }
	| { type: "Custom"; value: string };

export type CommandResult = {
	status: "Success" | "Error";
	message?: string;
};

export type LogEntry = {
	level: "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE";
	message: string;
	target: string;
};
