import { err, ok, type Result } from "neverthrow";
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
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../../types/smtc";
import { resizeImageUrl, throttle, waitForElement } from "../../utils";
import { NcmEventAdapter, type ParsedEventMap } from "../../utils/event";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap, PlayModeInfo } from "../adapter";
import { PlayModeController } from "../playModeController";

const Controller = ctl;
const DataController = dc;

const NCM_PLAY_MODES = {
	LIST_LOOP: "playorder",
	SINGLE_LOOP: "playcycle",
	RANDOM: "playrandom",
	ORDER: "playonce",
	AI: "playai",
} as const;

const V2_MODE_CONSTANTS = {
	SHUFFLE: NCM_PLAY_MODES.RANDOM,
	LOOP: NCM_PLAY_MODES.LIST_LOOP,
	ONE_LOOP: NCM_PLAY_MODES.SINGLE_LOOP,
	ORDER: NCM_PLAY_MODES.ORDER,
	AI: NCM_PLAY_MODES.AI,
};

type NcmPlayMode = (typeof NCM_PLAY_MODES)[keyof typeof NCM_PLAY_MODES];

function isValidNcmPlayMode(
	mode: string | undefined,
): mode is NcmPlayMode | undefined {
	if (mode === undefined) {
		return true;
	}
	return (Object.values(NCM_PLAY_MODES) as string[]).includes(mode);
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

	public switchMode(mode: NcmPlayMode): void {
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

	public get currentSongData(): v2.SongData | null {
		const trackObject = this.playerInstance.MF?.U();
		return trackObject?.data ?? null;
	}
}

class NcmV2ApiClient {
	public getActivePlayerInstance(): v2.PlayerInstance | null {
		return Controller.player?.Hn() ?? null;
	}

	public getProgramFromCache(
		id: number | string,
	): v2.ProgramCacheData | null | undefined {
		return DataController.program.$(id);
	}

	public getVolume(): number {
		return Controller.cefPlayer?.K6() ?? 1.0;
	}

	public isMuted(): boolean {
		return Controller.cefPlayer?.a6 ?? false;
	}

	public setVolume(level: number): void {
		const clampedLevel = Math.max(0, Math.min(1, level));
		Controller.cefPlayer?.F6(clampedLevel);
	}

	public setMuted(mute: boolean): void {
		Controller.cefPlayer?.T6(mute);
	}

	public addVolumeListener(
		callback: v2.CefPlayerEventMap["onvolumechange"],
	): void {
		Controller.cefPlayer?.Ti("onvolumechange", callback);
	}

	public removeVolumeListener(
		callback: v2.CefPlayerEventMap["onvolumechange"],
	): void {
		Controller.cefPlayer?.Ii("onvolumechange", callback);
	}

	public addMuteListener(callback: v2.CefPlayerEventMap["onmutechange"]): void {
		Controller.cefPlayer?.Ti("onmutechange", callback);
	}

	public removeMuteListener(
		callback: v2.CefPlayerEventMap["onmutechange"],
	): void {
		Controller.cefPlayer?.Ii("onmutechange", callback);
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

	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playStatus: PlaybackStatus = "Paused";
	private lastReduxTrackId: number | null = null;
	private lastPlayMode: NcmPlayMode | undefined = undefined;

	private volume = 1.0;
	private isMuted = false;

	private readonly playModeController = new PlayModeController(
		V2_MODE_CONSTANTS,
	);

	private readonly dispatchTimelineThrottled: () => void;
	private readonly resetTimelineThrottle: () => void;

	constructor() {
		super();
		this.eventAdapter = new NcmEventAdapter("v2");
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
			logger.error("[Adapter V2] 初始化 Redux store 失败:", storeResult.error);
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
			logger.warn("[Adapter V2] 初始化获取音量状态失败:", e);
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

		logger.debug("[Adapter V2] Disposed.");
	}

	public getCurrentSongInfo(): Result<SongInfo, NcmAdapterError> {
		const playerApi = this.activePlayerApi;
		const songData = playerApi?.currentSongData ?? null;

		if (!songData?.id) return err(new SongNotFoundError());

		if (typeof songData.programId === "number") {
			const programCache = this.apiClient.getProgramFromCache(
				songData.programId,
			);

			if (programCache) {
				return ok({
					songName: programCache.name || "未知播客",
					authorName: programCache.dj?.nickname || "未知主播",
					albumName: programCache.radio?.name || "未知播单",
					thumbnailUrl: resizeImageUrl(programCache.coverUrl),
					ncmId: programCache.id,
				});
			}

			return ok({
				songName: songData.name || "未知播客",
				authorName:
					songData.artists?.map((v) => v.name).join(" / ") || "未知主播",
				albumName: songData.radio?.name || "未知播单",
				thumbnailUrl: resizeImageUrl(
					songData.radio?.picUrl ?? songData.album?.picUrl,
				),
				ncmId: songData.programId,
			});
		}

		return ok({
			songName: songData.name || "未知歌名",
			authorName:
				songData.artists?.map((v) => v.name).join(" / ") || "未知艺术家",
			albumName: songData.album?.name || "未知专辑",
			thumbnailUrl: resizeImageUrl(songData.album?.picUrl),
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

	public getPlayMode(): PlayModeInfo {
		const currentNcmMode = this.reduxStore?.getState().playing?.playMode;
		let isShuffling = false;
		let repeatMode: RepeatMode = "None";

		if (isValidNcmPlayMode(currentNcmMode)) {
			switch (currentNcmMode) {
				case NCM_PLAY_MODES.RANDOM:
					isShuffling = true;
					repeatMode = "List";
					break;
				case NCM_PLAY_MODES.LIST_LOOP:
					isShuffling = false;
					repeatMode = "List";
					break;
				case NCM_PLAY_MODES.SINGLE_LOOP:
					isShuffling = false;
					repeatMode = "Track";
					break;
				case NCM_PLAY_MODES.ORDER:
					isShuffling = false;
					repeatMode = "None";
					break;
			}
		}

		return { isShuffling, repeatMode };
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
		const currentMode = this.reduxStore?.getState()?.playing?.playMode;
		if (!isValidNcmPlayMode(currentMode) || !currentMode) return;

		const targetMode = this.playModeController.getNextShuffleMode(currentMode);
		this.activePlayerApi?.switchMode(targetMode as NcmPlayMode);
	}

	public toggleRepeat(): void {
		const currentMode = this.reduxStore?.getState()?.playing?.playMode;
		if (!isValidNcmPlayMode(currentMode) || !currentMode) return;

		const targetMode = this.playModeController.getNextRepeatMode(currentMode);
		this.activePlayerApi?.switchMode(targetMode as NcmPlayMode);
	}

	public setRepeatMode(mode: RepeatMode): void {
		const currentMode = this.reduxStore?.getState()?.playing?.playMode;
		if (!isValidNcmPlayMode(currentMode) || !currentMode) return;

		const targetMode = this.playModeController.getRepeatMode(mode, currentMode);
		this.activePlayerApi?.switchMode(targetMode as NcmPlayMode);
	}

	public setVolume(level: number): void {
		this.apiClient.setVolume(level);
	}

	public toggleMute(): void {
		this.apiClient.setMuted(!this.isMuted);
	}

	private onStateChanged(): void {
		if (!this.reduxStore) return;
		const playingState = this.reduxStore.getState()?.playing;
		if (!playingState) return;

		const newTrackId = playingState.resourceTrackId;
		if (newTrackId && newTrackId !== this.lastReduxTrackId) {
			this.lastReduxTrackId = newTrackId;

			const songInfoResult = this.getCurrentSongInfo();
			if (songInfoResult.isOk()) {
				this.dispatchEvent(
					new CustomEvent<SongInfo>("songChange", {
						detail: songInfoResult.value,
					}),
				);
				const songData = this.activePlayerApi?.currentSongData;
				const newDuration = songData?.duration || 0;
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
			}
		}

		const newPlayMode = playingState.playMode;
		if (
			isValidNcmPlayMode(newPlayMode) &&
			newPlayMode &&
			newPlayMode !== this.lastPlayMode
		) {
			this.lastPlayMode = newPlayMode;
			this.dispatchEvent(
				new CustomEvent<PlayModeInfo>("playModeChange", {
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
			logger.error("[Adapter V2] 注册音量事件监听失败:", e);
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
			logger.error("[Adapter V2] 清理原生事件监听时发生错误:", e);
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
