import type { Result } from "neverthrow";
import type { NcmAdapterError } from "../types/errors";
import type {
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../types/smtc";

export type NcmAdapterEventMap = {
	songChange: CustomEvent<SongInfo>;
	playStateChange: CustomEvent<PlaybackStatus>;
	playModeChange: CustomEvent<PlayMode>;
	timelineUpdate: CustomEvent<TimelineInfo>;
	volumeChange: CustomEvent<VolumeInfo>;
};

export interface INcmAdapter extends EventTarget {
	initialize(): Promise<Result<void, NcmAdapterError>>;
	dispose(): void;
	getCurrentSongInfo(): Result<SongInfo, NcmAdapterError>;
	getPlaybackStatus(): PlaybackStatus;
	getTimelineInfo(): Result<TimelineInfo, NcmAdapterError>;
	getPlayMode(): PlayMode;
	getVolumeInfo(): VolumeInfo;

	hasNativeSmtcSupport(): boolean;
	setInternalLogging(enabled: boolean): void;

	play(): void;
	pause(): void;
	stop(): void;
	nextSong(): void;
	previousSong(): void;
	seekTo(positionMs: number): void;
	toggleShuffle(): void;
	toggleRepeat(): void;
	setRepeatMode(mode: RepeatMode): void;
	setVolume(level: number): void;
	toggleMute(): void;

	setResolution(resolution: string): void;

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
