export type PlaybackStatus = "Playing" | "Paused";

export interface SongInfo {
	songName: string;
	albumName: string;
	authorName: string;
	thumbnailUrl: string;
	/**
	 * 歌曲ID，可用于精确匹配歌曲
	 *
	 * 后端会把 ID 拼接为 `NCM-{ID}` 并上传到 SMTC 的流派字段
	 */
	ncmId: number;
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

export type SmtcSimpleEvent = {
	type:
		| "Play"
		| "Pause"
		| "NextSong"
		| "PreviousSong"
		| "ToggleShuffle"
		| "ToggleRepeat";
};

export type SmtcSeekEvent = {
	type: "Seek";
	position_ms: number;
};

export type SmtcEvent = SmtcSimpleEvent | SmtcSeekEvent;

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

export interface ProviderEventMap {
	updateSongInfo: CustomEvent<SongInfo>;
	updatePlayState: CustomEvent<PlaybackStatus>;
	updateTimeline: CustomEvent<TimelineInfo>;
	updatePlayMode: CustomEvent<PlayModePayload>;
	updateVolume: CustomEvent<VolumeInfo>;
	disable: CustomEvent<void>;
	control: CustomEvent<ControlMessage>;
}
