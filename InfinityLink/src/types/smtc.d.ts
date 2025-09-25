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
	| { type: "Seek"; position: number };

export type CommandData =
	| {
			command: "UpdateMetadata";
			data: {
				title: string;
				artist: string;
				album: string;
				thumbnail_base64: string;
			};
	  }
	| {
			command: "UpdateTimeline";
			data: {
				current: number;
				total: number;
			};
	  }
	| {
			command: "UpdateStatus";
			data: 3 | 4;
	  }
	| {
			command: "UpdatePlayMode";
			data: {
				is_shuffling: boolean;
				repeat_mode: string;
			};
	  };
