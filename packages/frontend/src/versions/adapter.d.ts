import type { Result } from "neverthrow";
import type {
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../types/backend";
import type { NcmAdapterError } from "../types/errors";
import type { TypedEventTarget } from "../utils/TypedEventTarget";

export type NcmAdapterEventMap = {
	songChange: CustomEvent<SongInfo>;
	playStateChange: CustomEvent<PlaybackStatus>;
	playModeChange: CustomEvent<PlayMode>;
	timelineUpdate: CustomEvent<TimelineInfo>;
	rawTimelineUpdate: CustomEvent<TimelineInfo>;
	volumeChange: CustomEvent<VolumeInfo>;
};

export interface INcmAdapter extends TypedEventTarget<NcmAdapterEventMap> {
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
}
