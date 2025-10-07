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

export type ControlMessage =
	| {
			type:
				| "Pause"
				| "Play"
				| "PreviousSong"
				| "NextSong"
				| "ToggleShuffle"
				| "ToggleRepeat";
	  }
	| {
			type: "Seek";
			position: number;
	  }
	| {
			type: "SetRepeat";
			mode: RepeatMode;
	  };

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
export interface PlayModePayload {
	isShuffling: boolean;
	repeatMode: RepeatMode;
}
export type RepeatMode = "None" | "Track" | "List" | "AI";

export type SmtcCommandPayloads = {
	Metadata: MetadataPayload;
	PlayState: PlayStatePayload;
	Timeline: TimelinePayload;
	PlayMode: PlayModePayload;
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
	disable: CustomEvent<void>;
	control: CustomEvent<ControlMessage>;
}
