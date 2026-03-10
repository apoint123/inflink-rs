import type {
	PlaybackEventMap,
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../types/api";
import type { TypedEventTarget } from "../utils/TypedEventTarget";

export interface INcmAdapter extends TypedEventTarget<PlaybackEventMap> {
	initialize(): Promise<void>;
	dispose(): void;
	getCurrentSongInfo(): SongInfo | null;
	getPlaybackStatus(): PlaybackStatus;
	getTimelineInfo(): TimelineInfo | null;
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
}
