export type PlaybackStatus = "Playing" | "Paused";

export interface SongInfo {
	songName: string;
	albumName: string;
	authorName: string;
	thumbnail_base64: string;
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
	repeatMode: string;
}

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
