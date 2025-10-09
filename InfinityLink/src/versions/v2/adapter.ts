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
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap, PlayModeInfo } from "../adapter";
import { PlayModeController } from "../playModeController";

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
		return this.playerInstance.x6?.data ?? null;
	}

	public getFmSongData(): v2.SongData | null {
		const trackObject = this.playerInstance._t?.();
		return trackObject?.data ?? null;
	}

	public static getVolume(): number {
		return ctl.cefPlayer?.K6() ?? 1.0;
	}

	public static isMuted(): boolean {
		return ctl.cefPlayer?.a6 ?? false;
	}

	public static setVolume(level: number): void {
		const clampedLevel = Math.max(0, Math.min(1, level));
		ctl.cefPlayer?.F6(clampedLevel);
	}

	public static setMuted(mute: boolean): void {
		ctl.cefPlayer?.T6(mute);
	}

	public static addVolumeListener(
		callback: v2.CefPlayerEventMap["onvolumechange"],
	): void {
		ctl.cefPlayer?.Ti("onvolumechange", callback);
	}

	public static addMuteListener(
		callback: v2.CefPlayerEventMap["onmutechange"],
	): void {
		ctl.cefPlayer?.Ti("onmutechange", callback);
	}

	public static removeVolumeListener(
		callback: v2.CefPlayerEventMap["onvolumechange"],
	): void {
		ctl.cefPlayer?.Ii("onvolumechange", callback);
	}

	public static removeMuteListener(
		callback: v2.CefPlayerEventMap["onmutechange"],
	): void {
		ctl.cefPlayer?.Ii("onmutechange", callback);
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

	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playStatus: PlaybackStatus = "Paused";
	private lastReduxTrackId: number | null = null;
	private lastPlayMode: NcmPlayMode | undefined = undefined;

	private volume = 1.0;
	private isMuted = false;

	private readonly dispatchTimelineThrottled: () => void;
	private readonly playModeController = new PlayModeController(
		V2_MODE_CONSTANTS,
	);

	constructor() {
		super();
		this.dispatchTimelineThrottled = throttle(() => {
			this.dispatchEvent(
				new CustomEvent<TimelineInfo>("timelineUpdate", {
					detail: {
						currentTime: this.musicPlayProgress,
						totalTime: this.musicDuration,
					},
				}),
			);
		}, 1000)[0];
	}

	private get activePlayerApi(): NcmV2PlayerApi | null {
		const currentPlayerInstance = ctl.player?.Hn();
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
			this.volume = NcmV2PlayerApi.getVolume();
			this.isMuted = NcmV2PlayerApi.isMuted();
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
		this.unregisterNcmEvents();

		logger.debug("[Adapter V2] Disposed.");
	}

	public getCurrentSongInfo(): Result<SongInfo, NcmAdapterError> {
		let songData: v2.SongData | null = null;
		const playerApi = this.activePlayerApi;

		if (playerApi) {
			songData = playerApi.currentSongData;
			// FM 模式
			if (!songData) {
				songData = playerApi.getFmSongData();
			}
		}

		if (!songData?.id) return err(new SongNotFoundError());

		return ok({
			songName: songData.name || "未知歌名",
			authorName: songData.artists?.map((v) => v.name).join(" / ") || "",
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
		NcmV2PlayerApi.setVolume(level);
	}

	public toggleMute(): void {
		NcmV2PlayerApi.setMuted(!this.isMuted);
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
		legacyNativeCmder.appendRegisterCall(
			"PlayState",
			"audioplayer",
			(_audioId: string, state: string) => this.onPlayStateChanged(state),
		);
		legacyNativeCmder.appendRegisterCall(
			"PlayProgress",
			"audioplayer",
			(_audioId: string, progress: number) => this.onPlayProgress(progress),
		);

		try {
			NcmV2PlayerApi.addVolumeListener(this.onVolumeChanged);
			NcmV2PlayerApi.addMuteListener(this.onMuteChanged);
		} catch (e) {
			logger.error("[Adapter V2] 注册音量事件监听失败:", e);
		}
	}

	private unregisterNcmEvents(): void {
		try {
			legacyNativeCmder.removeRegisterCall(
				"PlayState",
				"audioplayer",
				this.onPlayStateChanged,
			);
			legacyNativeCmder.removeRegisterCall(
				"PlayProgress",
				"audioplayer",
				this.onPlayProgress,
			);

			NcmV2PlayerApi.removeVolumeListener(this.onVolumeChanged);
			NcmV2PlayerApi.removeMuteListener(this.onMuteChanged);
		} catch (e) {
			logger.error("[Adapter V2] 清理原生事件监听时发生错误:", e);
		}
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

	private readonly onPlayProgress = (progressInSeconds: number): void => {
		this.musicPlayProgress = Math.floor(progressInSeconds * 1000);
		const newDuration = this.activePlayerApi?.getDuration() ?? 0;
		if (newDuration > 0) {
			this.musicDuration = Math.floor(newDuration * 1000);
		}
		this.dispatchTimelineThrottled();
	};

	private readonly onPlayStateChanged = (stateInfo: string): void => {
		const parts = stateInfo.split("|");
		let newPlayState: PlaybackStatus | undefined;

		if (parts.length >= 2) {
			const stateKeyword = parts[1];
			switch (stateKeyword) {
				case "resume":
				case "play":
					newPlayState = "Playing";
					break;
				case "pause":
					newPlayState = "Paused";
					break;
				default:
					logger.warn(`[Adapter V2] 未知的播放状态: ${stateKeyword}`);
					return;
			}
		} else {
			logger.warn(`[Adapter V2] 意外的播放状态: ${stateInfo}`);
			return;
		}

		if (newPlayState && this.playStatus !== newPlayState) {
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
