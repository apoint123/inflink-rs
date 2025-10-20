import { err, ok, type Result } from "neverthrow";
import type { ResolutionSetting } from "../../hooks";
import {
	DomElementNotFoundError,
	type NcmAdapterError,
	ReduxStoreNotFoundError,
	SongNotFoundError,
	TimelineNotAvailableError,
} from "../../types/errors";
import type { v2 } from "../../types/ncm";
import type {
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../../types/smtc";
import { CoverManager, throttle, waitForElement } from "../../utils";
import { NcmEventAdapter, type ParsedEventMap } from "../../utils/event";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap } from "../adapter";
import { PlayModeController } from "../playModeController";

const Controller = typeof ctl !== "undefined" ? ctl : null;
const DataController = typeof dc !== "undefined" ? dc : null;

const V2_PLAY_MODES = {
	LIST_LOOP: "playorder",
	SINGLE_LOOP: "playcycle",
	RANDOM: "playrandom",
	ORDER: "playonce",
	AI: "playai",
} as const;

type NcmV2PlayMode = (typeof V2_PLAY_MODES)[keyof typeof V2_PLAY_MODES];

function isValidNcmPlayMode(
	mode: string | undefined,
): mode is NcmV2PlayMode | undefined {
	if (mode === undefined) {
		return true;
	}
	return (Object.values(V2_PLAY_MODES) as string[]).includes(mode);
}

function toCanonicalPlayMode(ncmMode: NcmV2PlayMode): PlayMode {
	switch (ncmMode) {
		case V2_PLAY_MODES.RANDOM:
			return { isShuffling: true, repeatMode: "List" };
		case V2_PLAY_MODES.LIST_LOOP:
			return { isShuffling: false, repeatMode: "List" };
		case V2_PLAY_MODES.SINGLE_LOOP:
			return { isShuffling: false, repeatMode: "Track" };
		case V2_PLAY_MODES.ORDER:
			return { isShuffling: false, repeatMode: "None" };
		case V2_PLAY_MODES.AI:
			return { isShuffling: false, repeatMode: "AI" };
		default:
			return { isShuffling: false, repeatMode: "None" };
	}
}

function fromCanonicalPlayMode(playMode: PlayMode): NcmV2PlayMode {
	if (playMode.isShuffling) {
		return V2_PLAY_MODES.RANDOM;
	}
	switch (playMode.repeatMode) {
		case "List":
			return V2_PLAY_MODES.LIST_LOOP;
		case "Track":
			return V2_PLAY_MODES.SINGLE_LOOP;
		case "AI":
			return V2_PLAY_MODES.AI;
		default:
			return V2_PLAY_MODES.ORDER;
	}
}

/**
 * 封装了对 v2 播放器实例的混淆 API 调用
 *
 * 这个类的实例代表一个播放器（defPlayer, fmPlayer等）
 *
 * 直接使用混淆后的函数名很脆弱，但考虑到网易云 v2 都不更新了，
 * 直接使用问题也不大
 *
 * 如果某天网易云真的又给 v2 更新了一个版本，这里几乎肯定需要全部修改
 */
class NcmV2PlayerApi {
	private readonly playerInstance: v2.PlayerInstance;

	constructor(playerInstance: v2.PlayerInstance) {
		this.playerInstance = playerInstance;
	}

	public resume(): void {
		this.playerInstance.KJ("play");
	}

	public pause(): void {
		this.playerInstance.KJ("pause");
	}

	public next(): void {
		this.playerInstance.KJ("playnext");
	}

	public previous(): void {
		this.playerInstance.KJ("playprev");
	}

	public seek(progressRatio: number): void {
		this.playerInstance.Qn(progressRatio);
	}

	public switchMode(mode: NcmV2PlayMode): void {
		this.playerInstance.KJ(`mode_${mode}`);
	}

	public getProgress(): number {
		return this.playerInstance?.Gn?.() ?? 0;
	}

	public getDuration(): number {
		return this.playerInstance?.tQ ?? 0;
	}

	public isPlaying(): boolean {
		// OT() 在网易云刚启动，还未开始播放时不可用
		return (
			typeof this.playerInstance.OT === "function" && this.playerInstance.OT()
		);
	}

	public getCurrentTrackObject(): v2.PlayerTrack | null {
		return this.playerInstance.MF?.U() ?? null;
	}
}

class NcmV2ApiClient {
	public getActivePlayerInstance(): v2.PlayerInstance | null {
		return Controller?.player?.Hn() ?? null;
	}

	public getProgramFromCache(
		id: number | string,
	): v2.ProgramCacheData | null | undefined {
		return DataController?.program.$(id);
	}

	public getVolume(): number {
		return Controller?.cefPlayer?.K6() ?? 1.0;
	}

	public isMuted(): boolean {
		return Controller?.cefPlayer?.a6 ?? false;
	}

	public setVolume(level: number): void {
		const clampedLevel = Math.max(0, Math.min(1, level));
		Controller?.cefPlayer?.F6(clampedLevel);
	}

	public setMuted(mute: boolean): void {
		Controller?.cefPlayer?.T6(mute);
	}

	public addVolumeListener(
		callback: v2.CefPlayerEventMap["onvolumechange"],
	): void {
		Controller?.cefPlayer?.Ti("onvolumechange", callback);
	}

	public removeVolumeListener(
		callback: v2.CefPlayerEventMap["onvolumechange"],
	): void {
		Controller?.cefPlayer?.Ii("onvolumechange", callback);
	}

	public addMuteListener(callback: v2.CefPlayerEventMap["onmutechange"]): void {
		Controller?.cefPlayer?.Ti("onmutechange", callback);
	}

	public removeMuteListener(
		callback: v2.CefPlayerEventMap["onmutechange"],
	): void {
		Controller?.cefPlayer?.Ii("onmutechange", callback);
	}
}

interface FiberNode {
	memoizedProps?: {
		store?: v2.NCMStore;
	};
	return: FiberNode | null;
}

// 网易云v2的store路径包含每次启动都变化的哈希，所以得每次都寻找它
async function findReduxStore(
	selector: string,
): Promise<
	Result<v2.NCMStore, DomElementNotFoundError | ReduxStoreNotFoundError>
> {
	const rootEl = await waitForElement(selector);
	if (!rootEl) {
		return err(new DomElementNotFoundError(selector));
	}

	const findStoreInFiberTree = (
		node: FiberNode | null,
	): Result<v2.NCMStore, ReduxStoreNotFoundError> => {
		let currentNode = node;
		while (currentNode) {
			if (currentNode.memoizedProps?.store) {
				return ok(currentNode.memoizedProps.store);
			}
			currentNode = currentNode.return;
		}
		return err(new ReduxStoreNotFoundError("找不到 redux store"));
	};

	const appEl = rootEl.firstElementChild as HTMLElement;
	if (!appEl) {
		return err(new ReduxStoreNotFoundError("根元素没有子元素"));
	}

	const fiberKey = Object.keys(appEl).find(
		(key) =>
			key.startsWith("__reactFiber$") ||
			key.startsWith("__reactInternalInstance$"),
	);
	if (!fiberKey) {
		return err(new ReduxStoreNotFoundError("找不到 Fiber key"));
	}

	const startNode = (appEl as unknown as Record<string, FiberNode>)[fiberKey];
	if (!startNode) {
		return err(new ReduxStoreNotFoundError("找不到起始 Fiber 节点"));
	}

	return findStoreInFiberTree(startNode);
}

export class V2NcmAdapter extends EventTarget implements INcmAdapter {
	private reduxStore: v2.NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private readonly eventAdapter: NcmEventAdapter;
	private readonly apiClient = new NcmV2ApiClient();
	private readonly coverManager = new CoverManager();
	private resolutionSetting: ResolutionSetting = "500";

	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playStatus: PlaybackStatus = "Paused";
	private lastPlayMode: NcmV2PlayMode | undefined = undefined;

	private lastDispatchedSongInfo: SongInfo | null = null;

	private volume = 1.0;
	private isMuted = false;

	private readonly playModeController = new PlayModeController();

	private readonly dispatchTimelineThrottled: () => void;
	private readonly resetTimelineThrottle: () => void;

	constructor() {
		super();
		this.eventAdapter = new NcmEventAdapter();
		[this.dispatchTimelineThrottled, , this.resetTimelineThrottle] = throttle(
			() => {
				this._dispatchTimelineUpdateNow();
			},
			1000,
		);
	}

	private get activePlayerApi(): NcmV2PlayerApi | null {
		const currentPlayerInstance = this.apiClient.getActivePlayerInstance();
		if (currentPlayerInstance) {
			return new NcmV2PlayerApi(currentPlayerInstance);
		}
		return null;
	}

	public async initialize(): Promise<Result<void, NcmAdapterError>> {
		const storeResult = await findReduxStore("#portal_root");
		if (storeResult.isErr()) {
			logger.error("初始化 Redux store 失败:", "Adapter V2", storeResult.error);
			return err(storeResult.error);
		}
		this.reduxStore = storeResult.value;

		if (import.meta.env.MODE === "development") {
			window.infstore = this.reduxStore;
		}

		this.unsubscribeStore = this.reduxStore.subscribe(() =>
			this.onStateChanged(),
		);

		try {
			this.volume = this.apiClient.getVolume();
			this.isMuted = this.apiClient.isMuted();
		} catch (e) {
			logger.warn("初始化获取音量状态失败:", "Adapter V2", e);
		}

		this.registerNcmEvents();
		this.onStateChanged();

		return ok(undefined);
	}

	public dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.eventAdapter.dispose();
		this.unregisterNcmEvents();

		logger.debug("Disposed.", "Adapter V2");
	}

	public getCurrentSongInfo(): Result<SongInfo, NcmAdapterError> {
		const playerApi = this.activePlayerApi;
		const trackObject = playerApi?.getCurrentTrackObject() ?? null;
		const songData = trackObject?.data;

		if (!songData) {
			return err(new SongNotFoundError("找不到 trackObject.data"));
		}

		if (typeof songData.id === "string") {
			const lrcid = trackObject?.from?.lrcid;
			const ncmId = typeof lrcid === "number" && lrcid > 0 ? lrcid : 0;

			return ok({
				songName: songData.name || "未知歌曲",
				authorName:
					songData.artists?.map((v) => v.name).join(" / ") || "未知作者",
				albumName: songData.album?.name || "未知专辑",
				thumbnailUrl: songData.album.picUrl,
				ncmId: ncmId,
			});
		}

		if (typeof songData.programId === "number") {
			const programCache = this.apiClient.getProgramFromCache(
				songData.programId,
			);

			if (programCache) {
				return ok({
					songName: programCache.name || "未知播客",
					authorName: programCache.dj?.nickname || "未知主播",
					albumName: programCache.radio?.name || "未知播单",
					thumbnailUrl: programCache.coverUrl,
					ncmId: programCache.id,
				});
			}

			return ok({
				songName: songData.name || "未知播客",
				authorName:
					songData.artists?.map((v) => v.name).join(" / ") || "未知主播",
				albumName: songData.radio?.name || "未知播单",
				thumbnailUrl: songData.radio?.picUrl ?? songData.album?.picUrl,
				ncmId: songData.programId,
			});
		}

		return ok({
			songName: songData.name || "未知歌名",
			authorName:
				songData.artists?.map((v) => v.name).join(" / ") || "未知艺术家",
			albumName: songData.album?.name || "未知专辑",
			thumbnailUrl: songData.album?.picUrl,
			ncmId: songData.id,
		});
	}

	public getPlaybackStatus(): PlaybackStatus {
		if (this.activePlayerApi) {
			return this.activePlayerApi.isPlaying() ? "Playing" : "Paused";
		}
		return this.playStatus;
	}

	public getTimelineInfo(): Result<TimelineInfo, NcmAdapterError> {
		if (this.musicDuration > 0) {
			return ok({
				currentTime: this.musicPlayProgress,
				totalTime: this.musicDuration,
			});
		}
		return err(new TimelineNotAvailableError());
	}

	public getPlayMode(): PlayMode {
		const currentNcmMode = this.reduxStore?.getState().playing?.playMode;
		if (isValidNcmPlayMode(currentNcmMode) && currentNcmMode) {
			return toCanonicalPlayMode(currentNcmMode);
		}
		return { isShuffling: false, repeatMode: "None" };
	}

	public getVolumeInfo(): VolumeInfo {
		return { volume: this.volume, isMuted: this.isMuted };
	}

	public play(): void {
		this.activePlayerApi?.resume();
	}

	public pause(): void {
		this.activePlayerApi?.pause();
		this.playStatus = "Paused";
		this.dispatchEvent(
			new CustomEvent<PlaybackStatus>("playStateChange", {
				detail: "Paused",
			}),
		);
	}

	public stop(): void {
		this.pause();
		this.seekTo(0);
	}

	public nextSong(): void {
		this.activePlayerApi?.next();
	}

	public previousSong(): void {
		this.activePlayerApi?.previous();
	}

	public seekTo(positionMs: number): void {
		if (this.musicDuration > 0) {
			const progressRatio = positionMs / this.musicDuration;
			this.musicPlayProgress = positionMs;

			this.dispatchEvent(
				new CustomEvent<TimelineInfo>("timelineUpdate", {
					detail: {
						currentTime: this.musicPlayProgress,
						totalTime: this.musicDuration,
					},
				}),
			);

			this.activePlayerApi?.seek(progressRatio);
		}
	}

	public toggleShuffle(): void {
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getNextShuffleMode(currentMode);
		const targetNcmMode = fromCanonicalPlayMode(nextMode);
		this.activePlayerApi?.switchMode(targetNcmMode);
	}

	public toggleRepeat(): void {
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getNextRepeatMode(currentMode);
		const targetNcmMode = fromCanonicalPlayMode(nextMode);
		this.activePlayerApi?.switchMode(targetNcmMode);
	}

	public setRepeatMode(mode: RepeatMode): void {
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getRepeatMode(mode, currentMode);
		const targetNcmMode = fromCanonicalPlayMode(nextMode);
		this.activePlayerApi?.switchMode(targetNcmMode);
	}

	public setVolume(level: number): void {
		this.apiClient.setVolume(level);
	}

	public toggleMute(): void {
		this.apiClient.setMuted(!this.isMuted);
	}

	public setResolution(resolution: string): void {
		this.resolutionSetting = resolution;
	}

	private onStateChanged(): void {
		if (!this.reduxStore) return;
		const playingState = this.reduxStore.getState()?.playing;
		if (!playingState) return;

		const songInfoResult = this.getCurrentSongInfo();
		if (songInfoResult.isErr()) {
			this.lastDispatchedSongInfo = null;
			return;
		}
		const currentSongInfo = songInfoResult.value;

		if (currentSongInfo.ncmId !== this.lastDispatchedSongInfo?.ncmId) {
			this.lastDispatchedSongInfo = currentSongInfo;

			this.coverManager.getCover(
				currentSongInfo,
				this.resolutionSetting,
				(result) => {
					this.dispatchEvent(
						new CustomEvent<SongInfo>("songChange", {
							detail: {
								...result.songInfo,
								thumbnailUrl: result.dataUri ?? "",
							},
						}),
					);
				},
			);

			const trackObject = this.activePlayerApi?.getCurrentTrackObject();
			const newDuration = trackObject?.data?.duration || 0;
			if (newDuration > 0) {
				this.musicDuration = newDuration;
			}
			this.musicPlayProgress = 0;
			this.dispatchEvent(
				new CustomEvent<TimelineInfo>("timelineUpdate", {
					detail: {
						currentTime: 0,
						totalTime: this.musicDuration,
					},
				}),
			);
		} else if (
			this.lastDispatchedSongInfo &&
			!this.lastDispatchedSongInfo.thumbnailUrl &&
			currentSongInfo.thumbnailUrl
		) {
			this.coverManager.getCover(
				currentSongInfo,
				this.resolutionSetting,
				(result) => {
					this.dispatchEvent(
						new CustomEvent<SongInfo>("songChange", {
							detail: {
								...result.songInfo,
								thumbnailUrl: result.dataUri ?? "",
							},
						}),
					);
					this.lastDispatchedSongInfo = {
						...result.songInfo,
						thumbnailUrl: result.dataUri ?? "",
					};
				},
			);
		}

		const newPlayMode = playingState.playMode;
		if (
			isValidNcmPlayMode(newPlayMode) &&
			newPlayMode &&
			newPlayMode !== this.lastPlayMode
		) {
			this.lastPlayMode = newPlayMode;
			this.dispatchEvent(
				new CustomEvent<PlayMode>("playModeChange", {
					detail: this.getPlayMode(),
				}),
			);
		}
	}

	private registerNcmEvents(): void {
		this.eventAdapter.addEventListener(
			"playStateChange",
			this.onPlayStateChanged,
		);
		this.eventAdapter.addEventListener("progressUpdate", this.onProgressUpdate);
		this.eventAdapter.addEventListener("seekUpdate", this.onSeekUpdate);

		try {
			this.apiClient.addVolumeListener(this.onVolumeChanged);
			this.apiClient.addMuteListener(this.onMuteChanged);
		} catch (e) {
			logger.error("注册音量事件监听失败:", "Adapter V2", e);
		}
	}

	private unregisterNcmEvents(): void {
		this.eventAdapter.removeEventListener(
			"playStateChange",
			this.onPlayStateChanged,
		);
		this.eventAdapter.removeEventListener(
			"progressUpdate",
			this.onProgressUpdate,
		);
		this.eventAdapter.removeEventListener("seekUpdate", this.onSeekUpdate);

		try {
			this.apiClient.removeVolumeListener(this.onVolumeChanged);
			this.apiClient.removeMuteListener(this.onMuteChanged);
		} catch (e) {
			logger.error("清理原生事件监听时发生错误:", "Adapter V2", e);
		}
	}

	private readonly onProgressUpdate = (
		e: ParsedEventMap["progressUpdate"],
	): void => {
		this.musicPlayProgress = e.detail;
		this.dispatchTimelineThrottled();
	};

	private readonly onSeekUpdate = (e: ParsedEventMap["seekUpdate"]): void => {
		this.musicPlayProgress = e.detail;
		this.resetTimelineThrottle();
		this._dispatchTimelineUpdateNow();
	};

	private _dispatchTimelineUpdateNow(): void {
		this.dispatchEvent(
			new CustomEvent<TimelineInfo>("timelineUpdate", {
				detail: {
					currentTime: this.musicPlayProgress,
					totalTime: this.musicDuration,
				},
			}),
		);
	}

	private readonly onVolumeChanged = (
		payload: v2.CefPlayerVolumePayload,
	): void => {
		const newVolume = payload.volume;
		if (this.volume !== newVolume) {
			this.volume = newVolume;
			this.dispatchVolumeChangeEvent();
		}
	};

	private readonly onMuteChanged = (payload: v2.CefPlayerMutePayload): void => {
		const newMuteState = payload.mute;
		if (this.isMuted !== newMuteState) {
			this.isMuted = newMuteState;
			this.dispatchVolumeChangeEvent();
		}
	};

	private dispatchVolumeChangeEvent(): void {
		this.dispatchEvent(
			new CustomEvent<VolumeInfo>("volumeChange", {
				detail: {
					volume: this.volume,
					isMuted: this.isMuted,
				},
			}),
		);
	}

	private readonly onPlayStateChanged = (
		e: ParsedEventMap["playStateChange"],
	): void => {
		const newPlayState = e.detail;
		if (this.playStatus !== newPlayState) {
			this.playStatus = newPlayState;
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: this.playStatus,
				}),
			);
		}
	};

	public override dispatchEvent<K extends keyof NcmAdapterEventMap>(
		event: NcmAdapterEventMap[K],
	): boolean {
		return super.dispatchEvent(event);
	}
}
