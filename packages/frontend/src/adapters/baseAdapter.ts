import type { INcmAdapter } from "@/adapters/adapter";
import { PlayModeController } from "@/adapters/playModeController";
import type {
	PlaybackEventMap,
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "@/types/api";
import {
	CoverManager,
	isSameSong,
	type TypedEventListenerOrEventListenerObject,
	TypedEventTarget,
	throttle,
} from "@/utils";
import logger from "@/utils/logger";

type AudioDataListener = TypedEventListenerOrEventListenerObject<
	PlaybackEventMap,
	"audioDataUpdate"
>;

export abstract class BaseNcmAdapter
	extends TypedEventTarget<PlaybackEventMap>
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
	protected currentTrackId: string | null = null;
	protected currentSongInfo: SongInfo | null = null;

	protected readonly dispatchTimelineThrottled: () => void;
	protected readonly resetTimelineThrottle: () => void;

	protected abstract onAudioDataSubscriptionStarted(): void;
	protected abstract onAudioDataSubscriptionEnded(): void;

	private audioDataListeners = new Set<AudioDataListener>();

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

		const isNewSong = !isSameSong(currentSongInfo, this.currentSongInfo);

		const currentCoverUrl = currentSongInfo.cover?.url;
		const isCoverChanged = currentCoverUrl !== this.lastDispatchedCoverUrl;

		if (isNewSong || isCoverChanged) {
			this.currentSongInfo = currentSongInfo;
			this.currentTrackId =
				currentSongInfo.trackId ??
				(currentSongInfo.ncmId > 0 ? String(currentSongInfo.ncmId) : null);
			this.lastDispatchedSongId = currentSongInfo.ncmId;
			this.lastDispatchedCoverUrl = currentCoverUrl;

			if (isNewSong) {
				logger.info(
					`曲目切换: ${currentSongInfo.songName} (trackId: ${this.currentTrackId}, ncmId: ${currentSongInfo.ncmId}, duration: ${currentSongInfo.duration}ms)`,
					"BaseNcmAdapter",
				);
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
					if (isSameSong(result.songInfo, this.currentSongInfo)) {
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

	/**
	 * 取当前歌曲, 并把封面解析成可直接送达后端的形式 (blob 优先)
	 *
	 * 供"会话里可能还没有当前歌元数据"的补发场景使用, 与 songChange 的正常
	 * 派发共用封面管线。等待取图期间切了歌时返回 null —— 过期元数据交由
	 * songChange 正常派发。中断同一首歌的在途取图是安全的: 中断后由本方法
	 * 重新发起并送达, 当前歌的元数据不会因此丢失。
	 */
	public async getResolvedCurrentSongInfo(): Promise<SongInfo | null> {
		const info = this.getCurrentSongInfo();
		if (!info) return null;

		try {
			const result = await this.coverManager.getCover(
				info,
				this.resolutionSetting,
			);
			if (!isSameSong(result.songInfo, this.currentSongInfo)) {
				return null;
			}
			return { ...result.songInfo, cover: result.cover };
		} catch (error) {
			// 取图中途被更新请求打断: 交给正常 songChange 流程
			if ((error as Error).name === "AbortError") return null;
			logger.error(
				`解析当前歌曲封面时错误: ${(error as Error).message}`,
				"BaseNcmAdapter",
			);
			return null;
		}
	}

	/**
	 * 判定一次原生进度事件是否属于当前曲目
	 *
	 * playId 形如 "${trackId}_${suffix}"；切歌后旧音频管线仍会短暂推送旧
	 * 曲目的进度，归属不符时必须丢弃，否则会把新曲的进度锚点盖回旧值。
	 * 解析失败或尚未建立曲目标识时按旧行为放行（fail-open）。
	 */
	protected isProgressForCurrentTrack(playId: string | undefined): boolean {
		if (!playId) return true;
		if (
			!this.currentTrackId &&
			(this.lastDispatchedSongId === null || this.lastDispatchedSongId === 0)
		) {
			return true;
		}

		// 从 playId 提取前置 trackId（网易云格式为 ${trackId}_${suffix} 或 ${trackId}|${suffix}）
		const separatorIndex = playId.search(/[_|]/);
		const eventTrackId =
			separatorIndex !== -1 ? playId.slice(0, separatorIndex) : playId;

		// 1. 与当前曲目的内部轨道唯一标识匹配（适用于本地音频 40 位哈希与在线音频纯数字 ID）
		if (this.currentTrackId) {
			if (eventTrackId.toLowerCase() === this.currentTrackId.toLowerCase()) {
				return true;
			}
			if (
				playId.toLowerCase().startsWith(`${this.currentTrackId.toLowerCase()}_`)
			) {
				return true;
			}
		}

		// 2. 与当前曲目的在线 ncmId 匹配（仅当 ncmId 为有效正整数时）
		if (this.lastDispatchedSongId !== null && this.lastDispatchedSongId !== 0) {
			const currentSongIdStr = String(this.lastDispatchedSongId);
			if (
				eventTrackId === currentSongIdStr ||
				playId.startsWith(`${currentSongIdStr}_`)
			) {
				return true;
			}
		}

		logger.debug(
			`丢弃不属于当前曲目的进度事件: playId=${playId}, eventTrackId=${eventTrackId}, currentTrackId=${this.currentTrackId}, ncmId=${this.lastDispatchedSongId}`,
			"BaseNcmAdapter",
		);
		return false;
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

	public override addEventListener<T extends keyof PlaybackEventMap & string>(
		type: T,
		listener: TypedEventListenerOrEventListenerObject<
			PlaybackEventMap,
			T
		> | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		super.addEventListener(type, listener, options);

		// 主要是为了让其他插件使用者可以直接 addEventListener("audioDataUpdate", ...)
		// 或者 removeEventListener("audioDataUpdate", ...) 而不需要先调用其他方法
		// 或者用别的特殊通道来开启音频管线和监听音频数据
		if (type === "audioDataUpdate" && listener) {
			const targetListener = listener as AudioDataListener;

			const isNew = !this.audioDataListeners.has(targetListener);
			if (isNew) {
				this.audioDataListeners.add(targetListener);

				if (this.audioDataListeners.size === 1) {
					this.onAudioDataSubscriptionStarted();
				}
			}
		}
	}

	public override removeEventListener<
		T extends keyof PlaybackEventMap & string,
	>(
		type: T,
		callback: TypedEventListenerOrEventListenerObject<
			PlaybackEventMap,
			T
		> | null,
		options?: EventListenerOptions | boolean,
	): void {
		super.removeEventListener(type, callback, options);

		if (type === "audioDataUpdate" && callback) {
			const targetCallback = callback as AudioDataListener;

			if (this.audioDataListeners.has(targetCallback)) {
				this.audioDataListeners.delete(targetCallback);

				if (this.audioDataListeners.size === 0) {
					this.onAudioDataSubscriptionEnded();
				}
			}
		}
	}
}
