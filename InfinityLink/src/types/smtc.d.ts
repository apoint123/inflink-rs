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
