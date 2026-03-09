import type { INcmAdapter, NcmAdapterEventMap } from "@/adapters/adapter";
import { PlayModeController } from "@/adapters/playModeController";
import type {
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "@/types/backend";
import { CoverManager, TypedEventTarget, throttle } from "@/utils";
import logger from "@/utils/logger";

export abstract class BaseNcmAdapter
	extends TypedEventTarget<NcmAdapterEventMap>
	implements INcmAdapter
{
	protected playState: PlaybackStatus = "Paused";
	protected musicDuration = 0;
	protected musicPlayProgress = 0;
	protected volume = 1.0;
	protected isMuted = false;
	protected resolutionSetting = "500";

	protected readonly coverManager = new CoverManager();
	protected readonly playModeController = new PlayModeController();

	protected lastDispatchedSongId: string | number | null = null;
	protected lastDispatchedCoverUrl: string | undefined = undefined;

	protected readonly dispatchTimelineThrottled: () => void;
	protected readonly resetTimelineThrottle: () => void;

	protected abstract onAudioDataSubscriptionStarted(): void;
	protected abstract onAudioDataSubscriptionEnded(): void;

	constructor() {
		super();
		[this.dispatchTimelineThrottled, , this.resetTimelineThrottle] = throttle(
			() => this.dispatchTimelineUpdateNow(),
			1000,
		);
	}

	public abstract initialize(): Promise<void>;
	public abstract dispose(): void;

	public abstract getCurrentSongInfo(): SongInfo | null;
	public abstract getPlayMode(): PlayMode;

	public abstract hasNativeSmtcSupport(): boolean;
	public abstract setInternalLogging(enabled: boolean): void;

	public abstract play(): void;
	public abstract pause(): void;
	public abstract nextSong(): void;
	public abstract previousSong(): void;
	public abstract seekTo(positionMs: number): void;
	public abstract setVolume(level: number): void;
	public abstract toggleMute(): void;

	protected abstract applyInternalPlayMode(mode: PlayMode): void;

	public getPlaybackStatus(): PlaybackStatus {
		return this.playState;
	}

	public getTimelineInfo(): TimelineInfo | null {
		if (this.musicDuration > 0) {
			return {
				currentTime: this.musicPlayProgress,
				totalTime: this.musicDuration,
			};
		}
		return null;
	}

	public getVolumeInfo(): VolumeInfo {
		return { volume: this.volume, isMuted: this.isMuted };
	}

	public setResolution(resolution: string): void {
		this.resolutionSetting = resolution;
	}

	public stop(): void {
		this.pause();
		this.seekTo(0);
	}

	public toggleShuffle(): void {
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getNextShuffleMode(currentMode);
		this.applyInternalPlayMode(nextMode);
	}

	public toggleRepeat(): void {
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getNextRepeatMode(currentMode);
		this.applyInternalPlayMode(nextMode);
	}

	public setRepeatMode(mode: RepeatMode): void {
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getRepeatMode(mode, currentMode);
		this.applyInternalPlayMode(nextMode);
	}

	protected processSongInfoChange(currentSongInfo: SongInfo | null): void {
		if (!currentSongInfo) {
			return;
		}

		const isNewSong =
			String(currentSongInfo.ncmId) !== String(this.lastDispatchedSongId);

		const currentCoverUrl = currentSongInfo.cover?.url;
		const isCoverChanged = currentCoverUrl !== this.lastDispatchedCoverUrl;

		if (isNewSong || isCoverChanged) {
			this.lastDispatchedSongId = currentSongInfo.ncmId;
			this.lastDispatchedCoverUrl = currentCoverUrl;

			if (isNewSong) {
				this.musicPlayProgress = 0;
				if (currentSongInfo.duration && currentSongInfo.duration > 0) {
					this.musicDuration = currentSongInfo.duration;
				} else {
					this.musicDuration = 0;
				}

				this.dispatchTimelineUpdateNow();
			}

			this.coverManager
				.getCover(currentSongInfo, this.resolutionSetting)
				.then((result) => {
					if (
						String(result.songInfo.ncmId) === String(this.lastDispatchedSongId)
					) {
						this.dispatch("songChange", {
							...result.songInfo,
							cover: result.cover,
						});
					}
				})
				.catch((error: Error) => {
					if (error.name === "AbortError") {
						return;
					}

					logger.error(`获取封面时错误: ${error.message}`, "BaseNcmAdapter");
				});
		}
	}

	protected updatePlayState(newState: PlaybackStatus): void {
		if (this.playState !== newState) {
			this.playState = newState;
			this.dispatch("playStateChange", this.playState);
		}
	}

	protected updateTimeline(currentTime: number, totalTime?: number): void {
		this.musicPlayProgress = currentTime;
		if (totalTime !== undefined && totalTime > 0) {
			this.musicDuration = totalTime;
		}

		this.dispatch("rawTimelineUpdate", {
			currentTime: this.musicPlayProgress,
			totalTime: this.musicDuration,
		});

		this.dispatchTimelineThrottled();
	}

	protected dispatchTimelineUpdateNow(): void {
		this.dispatch("timelineUpdate", {
			currentTime: this.musicPlayProgress,
			totalTime: this.musicDuration,
		});
	}

	protected updateVolume(volume: number, isMuted: boolean): void {
		if (this.volume !== volume || this.isMuted !== isMuted) {
			this.volume = volume;
			this.isMuted = isMuted;

			this.dispatch("volumeChange", {
				volume: this.volume,
				isMuted: this.isMuted,
			});
		}
	}
}
