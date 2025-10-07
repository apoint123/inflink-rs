import type {
	PlaybackStatus,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../types/smtc";

export type NcmAdapterEventMap = {
	songChange: CustomEvent<SongInfo>;
	playStateChange: CustomEvent<PlaybackStatus>;
	playModeChange: CustomEvent<PlayModeInfo>;
	timelineUpdate: CustomEvent<TimelineInfo>;
	volumeChange: CustomEvent<VolumeInfo>;
};

export interface PlayModeInfo {
	isShuffling: boolean;
	repeatMode: RepeatMode;
}

export interface INcmAdapter extends EventTarget {
	initialize(): Promise<void>;
	dispose(): void;
	getCurrentSongInfo(): SongInfo | null;
	getPlaybackStatus(): PlaybackStatus;
	getTimelineInfo(): TimelineInfo | null;
	getPlayMode(): PlayModeInfo;
	getVolumeInfo(): VolumeInfo;

	play(): void;
	pause(): void;
	nextSong(): void;
	previousSong(): void;
	seekTo(positionMs: number): void;
	toggleShuffle(): void;
	toggleRepeat(): void;
	setRepeatMode(mode: RepeatMode): void;
	setVolume(level: number): void;
	toggleMute(): void;

	addEventListener<K extends keyof NcmAdapterEventMap>(
		type: K,
		listener: (this: INcmAdapter, ev: NcmAdapterEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener<K extends keyof NcmAdapterEventMap>(
		type: K,
		listener: (this: INcmAdapter, ev: NcmAdapterEventMap[K]) => unknown,
		options?: boolean | EventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void;
}
