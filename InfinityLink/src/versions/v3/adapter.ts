import { err, ok, type Result } from "neverthrow";
import type { ResolutionSetting } from "../../hooks";
import {
	DomElementNotFoundError,
	InconsistentStateError,
	type NcmAdapterError,
	ReduxStoreNotFoundError,
	SongNotFoundError,
	TimelineNotAvailableError,
} from "../../types/errors";
import type { OrpheusCommand } from "../../types/global";
import type { v3 } from "../../types/ncm";
import type {
	PlaybackStatus,
	PlayMode,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../../types/smtc";
import {
	CoverManager,
	findModule,
	getWebpackRequire,
	throttle,
	waitForElement,
} from "../../utils";
import { NcmEventAdapter, type ParsedEventMap } from "../../utils/event";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap } from "../adapter";
import { PlayModeController } from "../playModeController";

const V3_PLAY_MODES = {
	SHUFFLE: "playRandom",
	LOOP: "playCycle",
	ONE_LOOP: "playOneCycle",
	ORDER: "playOrder",
	AI: "playAi",
	// 直接切换到 FM 播放模式会让网易云进入一个不一致的状态
	// 如果要进入 FM 模式，应该用别的方式
	FM: "playFm",
} as const;

type NcmV3PlayMode = (typeof V3_PLAY_MODES)[keyof typeof V3_PLAY_MODES];

function toCanonicalPlayMode(ncmMode: NcmV3PlayMode): PlayMode {
	switch (ncmMode) {
		case V3_PLAY_MODES.SHUFFLE:
			return { isShuffling: true, repeatMode: "List" };
		case V3_PLAY_MODES.LOOP:
			return { isShuffling: false, repeatMode: "List" };
		case V3_PLAY_MODES.ONE_LOOP:
			return { isShuffling: false, repeatMode: "Track" };
		case V3_PLAY_MODES.ORDER:
			return { isShuffling: false, repeatMode: "None" };
		case V3_PLAY_MODES.AI:
			return { isShuffling: false, repeatMode: "AI" };
		default:
			return { isShuffling: false, repeatMode: "None" };
	}
}

function fromCanonicalPlayMode(playMode: PlayMode): NcmV3PlayMode {
	if (playMode.isShuffling) {
		return V3_PLAY_MODES.SHUFFLE;
	}
	switch (playMode.repeatMode) {
		case "List":
			return V3_PLAY_MODES.LOOP;
		case "Track":
			return V3_PLAY_MODES.ONE_LOOP;
		case "AI":
			return V3_PLAY_MODES.AI;
		default:
			return V3_PLAY_MODES.ORDER;
	}
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FiberNode {
	memoizedProps?: {
		store?: v3.NCMStore;
	};
	return: FiberNode | null;
}

function findReduxStoreInFiberTree(node: FiberNode | null): v3.NCMStore | null {
	let currentNode = node;
	while (currentNode) {
		if (currentNode.memoizedProps?.store) {
			return currentNode.memoizedProps.store;
		}
		currentNode = currentNode.return;
	}
	return null;
}

function findStoreFromRootElement(rootEl: HTMLElement): v3.NCMStore | null {
	const appEl = rootEl.firstElementChild;
	if (!appEl) {
		logger.warn("#root 元素没有子元素", "Adapter V3");
		return null;
	}

	const fiberKey = Object.keys(appEl).find(
		(key) =>
			key.startsWith("__reactFiber$") || // >= react 17
			key.startsWith("__reactInternalInstance$"), // < react 17, 网易云使用 react 16.14
	);
	if (!fiberKey) {
		logger.warn("找不到 React Fiber key", "Adapter V3");
		return null;
	}

	const startNode = (appEl as unknown as Record<string, FiberNode>)[fiberKey];
	if (!startNode) {
		logger.warn("找不到起始 Fiber 节点", "Adapter V3");
		return null;
	}

	return findReduxStoreInFiberTree(startNode);
}

async function waitForReduxStore(
	timeoutMs = 10000,
): Promise<
	Result<v3.NCMStore, DomElementNotFoundError | ReduxStoreNotFoundError>
> {
	const rootEl = (await waitForElement(
		SELECTORS.REACT_ROOT,
	)) as v3.ReactRootElement;
	if (!rootEl) {
		return err(
			new DomElementNotFoundError(
				`找不到 React 根元素 (${SELECTORS.REACT_ROOT})`,
			),
		);
	}

	const interval = 100;
	let elapsedTime = 0;

	while (elapsedTime < timeoutMs) {
		try {
			const store =
				rootEl._reactRootContainer?._internalRoot?.current?.child?.child
					?.memoizedProps?.store ?? findStoreFromRootElement(rootEl);

			if (store) {
				return ok(store);
			}
		} catch (e) {
			logger.info("Polling for Redux store failed once:", "Adapter V3", e);
		}

		await delay(interval);
		elapsedTime += interval;
	}

	return err(
		new ReduxStoreNotFoundError(`在 ${timeoutMs}ms 后仍未找到 Redux Store`),
	);
}

/**
 * CSS 选择器常量
 */
const SELECTORS = {
	// React 应用根节点
	REACT_ROOT: "#root",
};

const CONSTANTS = {
	// 时间线更新节流间隔
	TIMELINE_THROTTLE_INTERVAL_MS: 1000,
};

export class V3NcmAdapter extends EventTarget implements INcmAdapter {
	private reduxStore: v3.NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private eventAdapter!: NcmEventAdapter;
	private storageModule: v3.NcmStorageModule | null = null;
	private hasRestoredInitialState = false;
	private ignoreNextZeroProgressEvent = false;
	private readonly coverManager = new CoverManager();
	private resolutionSetting: ResolutionSetting = "500";

	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playState: PlaybackStatus = "Paused";
	private lastTrackId: string | null = null;
	private lastIsPlaying: boolean | null = null;
	private lastPlayMode: string | undefined = undefined;

	private lastVolume: number | null = null;
	private lastIsMuted: boolean | null = null;

	private readonly dispatchTimelineThrottled: () => void;
	private readonly resetTimelineThrottle: () => void;

	private readonly playModeController = new PlayModeController();

	constructor() {
		super();
		[this.dispatchTimelineThrottled, , this.resetTimelineThrottle] = throttle(
			() => this._dispatchTimelineUpdateNow(),
			CONSTANTS.TIMELINE_THROTTLE_INTERVAL_MS,
		);
	}

	public async initialize(): Promise<Result<void, NcmAdapterError>> {
		type BridgeContainerModule = { Bridge: OrpheusCommand };

		const require = await getWebpackRequire();

		/**
		 * 网易云 v3 内部存在两个 OrpheusCommand (legacyNativeCmder) 实例：
		 * 1. 一个是暴露在全局的 `window.legacyNativeCmder`
		 * 2. 另一个是未暴露的、供内部核心模块（如 AudioPlayer）使用的私有实例 (名为 Bridge)
		 *
		 * 核心 UI 组件（如进度条）的事件监听是注册在内部实例上的。如果我们使用全局实例去注册
		 * 监听器（特别是 PlayProgress 和 Seek），全局的监听器会覆盖掉 Bridge 中的监听器 (参见
		 * native.ts 中的实现)，导致进度条静止等怪异问题
		 *
		 * 因此，我们在这里：
		 * - 先通过 Webpack 模块查找获取到内部的 `Bridge` 实例
		 * - 如果查找失败，再回退到使用全局的 `window.legacyNativeCmder` 作为备用方案 (通常会导致问题)
		 */
		const bridgeContainer = findModule<BridgeContainerModule>(
			require,
			(exports: unknown): exports is BridgeContainerModule => {
				if (
					typeof exports !== "object" ||
					exports === null ||
					!("Bridge" in exports)
				) {
					return false;
				}
				const bridgeCandidate = (exports as { Bridge: unknown }).Bridge;
				return (
					typeof bridgeCandidate === "object" &&
					bridgeCandidate !== null &&
					"appendRegisterCall" in bridgeCandidate &&
					"call" in bridgeCandidate
				);
			},
		);

		const bridgeModule = bridgeContainer?.Bridge;

		let eventBinder: OrpheusCommand;
		if (bridgeModule) {
			logger.debug("使用内部 Bridge 实例注册事件", "Adapter V3");
			eventBinder = bridgeModule;
		} else {
			logger.warn(
				"未找到内部 Bridge 实例, 回退到全局 legacyNativeCmder",
				"Adapter V3",
			);
			eventBinder = window.legacyNativeCmder;
		}

		this.eventAdapter = new NcmEventAdapter(eventBinder);

		const storageContainer = findModule<v3.NcmStorageContainer>(
			require,
			(exports: unknown): exports is v3.NcmStorageContainer => {
				if (typeof exports !== "object" || exports === null) {
					return false;
				}
				if (
					!("b" in exports) ||
					typeof (exports as { b: unknown }).b !== "object" ||
					(exports as { b: unknown }).b === null
				) {
					return false;
				}

				const b = (exports as { b: Record<string, unknown> }).b;

				if (
					!("lastPlaying" in b) ||
					typeof b.lastPlaying !== "object" ||
					b.lastPlaying === null
				) {
					return false;
				}

				const lastPlaying = b.lastPlaying as Record<string, unknown>;

				return "get" in lastPlaying && typeof lastPlaying.get === "function";
			},
		);

		this.storageModule = storageContainer ? storageContainer.b : null;

		if (!this.storageModule) {
			logger.warn("未找到内部存储模块", "Adapter V3");
		} else if (import.meta.env.MODE === "development") {
			window.infStorage = this.storageModule;
		}

		const storeResult = await waitForReduxStore();
		if (storeResult.isErr()) {
			return err(storeResult.error);
		}
		this.reduxStore = storeResult.value;

		if (import.meta.env.MODE === "development") {
			window.infstore = this.reduxStore;
		}

		this.unsubscribeStore = this.reduxStore.subscribe(() =>
			this.onStateChanged(),
		);

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
		this.eventAdapter.dispose();

		logger.debug("Disposed.", "Adapter V3");
	}

	public getCurrentSongInfo(): Result<SongInfo, NcmAdapterError> {
		const state = this.reduxStore?.getState();
		const playingInfo = state?.playing;

		if (playingInfo?.resourceType === "voice") {
			const vinylInfo = state?.["page:vinylPage"];
			const currentVoice = vinylInfo?.currentVoice;

			if (
				!currentVoice ||
				String(currentVoice.id) !== String(playingInfo.onlineResourceId)
			) {
				return err(
					new InconsistentStateError(
						"播客信息尚未同步 (page:vinylPage 与 playing state 不一致)",
					),
				);
			}

			const voiceId = parseInt(currentVoice.id, 10);
			if (Number.isNaN(voiceId) || voiceId === 0) {
				return err(new SongNotFoundError("当前播客 voiceId 无效"));
			}

			return ok({
				songName: currentVoice.name || "未知播客",
				authorName:
					currentVoice.track?.artists?.map((v) => v.name).join(" / ") ||
					"未知主播",
				albumName: currentVoice.radio?.name || "未知播单",
				thumbnailUrl: currentVoice.coverUrl,
				ncmId: voiceId,
			});
		}

		if (!playingInfo?.resourceTrackId) {
			return err(new SongNotFoundError("Redux state 中找不到 resourceTrackId"));
		}

		const albumName =
			playingInfo.curTrack?.album?.albumName ??
			playingInfo.curTrack?.album?.name ??
			playingInfo.resourceName ??
			"未知专辑";

		const trackIdSource =
			(playingInfo.trackFileType === "local" && playingInfo.onlineResourceId) ||
			playingInfo.resourceTrackId;

		if (!trackIdSource) {
			return err(
				new SongNotFoundError(
					"Redux state 中找不到有效的 resourceTrackId 或 onlineResourceId",
				),
			);
		}

		let currentTrackId: number;
		const trackIdStr = String(trackIdSource);

		if (/^\d+$/.test(trackIdStr) && trackIdStr !== "0") {
			currentTrackId = parseInt(trackIdStr, 10);
		} else {
			currentTrackId = 0;
		}

		if (Number.isNaN(currentTrackId)) {
			return err(
				new SongNotFoundError(`解析 trackId 失败: "${trackIdSource}"`),
			);
		}

		const coverUrl = playingInfo.resourceCoverUrl || "";
		const thumbnailUrl = coverUrl;

		return ok({
			songName: playingInfo.resourceName || "未知歌名",
			authorName:
				playingInfo.resourceArtists?.map((v) => v.name).join(" / ") ||
				"未知艺术家",
			albumName: albumName,
			thumbnailUrl: thumbnailUrl,
			ncmId: currentTrackId,
		});
	}

	public getPlaybackStatus(): PlaybackStatus {
		const playingInfo = this.reduxStore?.getState().playing;
		if (typeof playingInfo?.playingState === "number") {
			return playingInfo.playingState === 2 ? "Playing" : "Paused";
		}
		return "Paused";
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
		const newNcmMode = this.reduxStore?.getState().playing?.playingMode;
		if (newNcmMode) {
			return toCanonicalPlayMode(newNcmMode);
		}
		return { isShuffling: false, repeatMode: "None" };
	}

	public getVolumeInfo(): VolumeInfo {
		const playingInfo = this.reduxStore?.getState().playing;
		const volume = playingInfo?.playingVolume ?? 1.0;
		const isMuted = volume === 0;
		return { volume, isMuted };
	}

	public play(): void {
		// triggerScene 应该是用来做数据分析的，大概有 45 种
		// 这里如果刚启动时不提供这个，就会因为 undefined 而报错
		this.reduxStore?.dispatch({
			type: "playing/resume",
			payload: { triggerScene: "track" },
		});
	}

	public pause(): void {
		// 网易云点击暂停后会有一两秒的淡出效果，此时还没有暂停
		// 要立刻认为已暂停并更新，不然会有延迟感
		this.reduxStore?.dispatch({ type: "playing/pause" });
		if (this.playState !== "Paused") {
			this.playState = "Paused";
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: this.playState,
				}),
			);
		}
	}

	public stop(): void {
		this.pause();
		this.seekTo(0);
	}

	public nextSong(): void {
		this.reduxStore?.dispatch({
			type: "playingList/jump2Track",
			payload: { flag: 1, type: "call", triggerScene: "track" },
		});
	}

	public previousSong(): void {
		this.reduxStore?.dispatch({
			type: "playingList/jump2Track",
			payload: { flag: -1, type: "call", triggerScene: "track" },
		});
	}

	public seekTo(positionMs: number): void {
		this.musicPlayProgress = positionMs;
		this.dispatchEvent(
			new CustomEvent<TimelineInfo>("timelineUpdate", {
				detail: {
					currentTime: this.musicPlayProgress,
					totalTime: this.musicDuration,
				},
			}),
		);
		this.reduxStore?.dispatch({
			type: "playing/setPlayingPosition",
			// 一个有误导性的名称，实际上是跳转位置
			payload: { duration: positionMs / 1000 },
		});
	}

	public toggleShuffle(): void {
		if (!this.reduxStore) return;
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getNextShuffleMode(currentMode);
		const targetNcmMode = fromCanonicalPlayMode(nextMode);

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			payload: { playingMode: targetNcmMode, triggerScene: "track" },
		});
	}

	public toggleRepeat(): void {
		if (!this.reduxStore) return;
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getNextRepeatMode(currentMode);
		const targetNcmMode = fromCanonicalPlayMode(nextMode);

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			// 这里的 triggerScene 用来确保在所有模式切换中都能工作
			// 尤其是心动模式 (虽然我们当前不会切换到心动模式)
			payload: { playingMode: targetNcmMode, triggerScene: "track" },
		});
	}

	public setRepeatMode(mode: RepeatMode): void {
		if (!this.reduxStore) return;
		const currentMode = this.getPlayMode();
		const nextMode = this.playModeController.getRepeatMode(mode, currentMode);
		const targetNcmMode = fromCanonicalPlayMode(nextMode);

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			payload: { playingMode: targetNcmMode, triggerScene: "track" },
		});
	}

	public setVolume(level: number): void {
		const clampedLevel = Math.max(0, Math.min(1, level));
		this.reduxStore?.dispatch({
			type: "playing/setVolume",
			payload: { volume: clampedLevel },
		});
	}

	public toggleMute(): void {
		this.reduxStore?.dispatch({ type: "playing/switchMute" });
	}

	public setResolution(resolution: ResolutionSetting): void {
		this.resolutionSetting = resolution;
	}

	private onStateChanged(): void {
		if (!this.reduxStore) return;
		const state = this.reduxStore.getState();
		const playingInfo = state.playing;

		const currentRawTrackId = playingInfo.resourceTrackId;
		if (currentRawTrackId && currentRawTrackId !== this.lastTrackId) {
			const songInfoResult = this.getCurrentSongInfo();

			if (songInfoResult.isErr()) {
				if (songInfoResult.error instanceof InconsistentStateError) {
					return;
				}

				logger.warn(
					"获取歌曲信息失败，但 trackId 已变更:",
					"Adapter V3",
					songInfoResult.error,
				);
				this.lastTrackId = currentRawTrackId;
				this.musicDuration = 0;
				return;
			}

			this.lastTrackId = currentRawTrackId;
			const songInfo = songInfoResult.value;

			this.coverManager.getCover(songInfo, this.resolutionSetting, (result) => {
				this.dispatchEvent(
					new CustomEvent<SongInfo>("songChange", {
						detail: { ...result.songInfo, thumbnailUrl: result.dataUri ?? "" },
					}),
				);
			});

			if (!this.hasRestoredInitialState) {
				this.hasRestoredInitialState = true;
				this.restoreLastPlaybackState();
			}

			if (playingInfo?.resourceType === "voice") {
				const duration = state["page:vinylPage"]?.currentVoice?.duration;
				if (typeof duration === "number") {
					this.musicDuration = duration;
				}
			} else {
				if (playingInfo?.curTrack?.duration) {
					this.musicDuration = playingInfo.curTrack.duration;
				}
			}
		}

		const isPlaying = this.getPlaybackStatus() === "Playing";
		if (isPlaying !== this.lastIsPlaying) {
			this.lastIsPlaying = isPlaying;
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: isPlaying ? "Playing" : "Paused",
				}),
			);
		}

		const playMode = playingInfo?.playingMode;
		if (playMode && playMode !== this.lastPlayMode) {
			this.lastPlayMode = playMode;
			this.dispatchEvent(
				new CustomEvent<PlayMode>("playModeChange", {
					detail: this.getPlayMode(),
				}),
			);
		}

		const newVolume = playingInfo?.playingVolume;
		if (typeof newVolume === "number" && newVolume !== this.lastVolume) {
			this.lastVolume = newVolume;
			const newIsMuted = newVolume === 0;

			if (newIsMuted !== this.lastIsMuted) {
				this.lastIsMuted = newIsMuted;
			}

			this.dispatchEvent(
				new CustomEvent<VolumeInfo>("volumeChange", {
					detail: { volume: newVolume, isMuted: newIsMuted },
				}),
			);
		}
	}

	private async restoreLastPlaybackState(): Promise<void> {
		if (!this.storageModule) {
			return;
		}

		const lastPlayingInfo = await this.storageModule.lastPlaying.get();
		const currentSongInfo = this.reduxStore?.getState().playing;

		if (
			!lastPlayingInfo?.trackId ||
			typeof lastPlayingInfo.current !== "number" ||
			!currentSongInfo?.resourceTrackId
		) {
			return;
		}

		if (
			String(lastPlayingInfo.trackId) ===
			String(currentSongInfo.resourceTrackId)
		) {
			const positionMs = lastPlayingInfo.current * 1000;

			if (positionMs > 0) {
				this.ignoreNextZeroProgressEvent = true;
			}

			this.musicPlayProgress = positionMs;
			this._dispatchTimelineUpdateNow();
		}
	}

	private registerNcmEvents(): void {
		this.eventAdapter.addEventListener(
			"playStateChange",
			this.onPlayStateChanged,
		);
		this.eventAdapter.addEventListener("progressUpdate", this.onProgressUpdate);
		this.eventAdapter.addEventListener("seekUpdate", this.onSeekUpdate);
	}

	private unregisterNcmEvents(): void {
		try {
			this.eventAdapter.removeEventListener(
				"playStateChange",
				this.onPlayStateChanged,
			);
			this.eventAdapter.removeEventListener(
				"progressUpdate",
				this.onProgressUpdate,
			);
			this.eventAdapter.removeEventListener("seekUpdate", this.onSeekUpdate);
		} catch (e) {
			logger.error("清理原生事件监听时发生错误:", "Adapter V3", e);
		}
	}

	private readonly onProgressUpdate = (
		e: ParsedEventMap["progressUpdate"],
	): void => {
		if (this.ignoreNextZeroProgressEvent && e.detail === 0) {
			this.ignoreNextZeroProgressEvent = false;
			return;
		}

		if (e.detail > 0) {
			this.ignoreNextZeroProgressEvent = false;
		}

		this.musicPlayProgress = e.detail;
		this.dispatchTimelineThrottled();
	};

	private readonly onSeekUpdate = (e: ParsedEventMap["seekUpdate"]): void => {
		this.musicPlayProgress = e.detail;
		this.resetTimelineThrottle();
		this._dispatchTimelineUpdateNow();
	};

	private readonly onPlayStateChanged = (
		e: ParsedEventMap["playStateChange"],
	): void => {
		const newPlayState = e.detail;
		if (this.playState !== newPlayState) {
			// v3 的播放状态由 redux store 更新
			// 在这里也同步的话，乐观暂停时这里也会尝试同步状态
			// 导致暂停按钮闪烁
			// this.playState = newPlayState;
		}
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

	public override dispatchEvent<K extends keyof NcmAdapterEventMap>(
		event: NcmAdapterEventMap[K],
	): boolean {
		return super.dispatchEvent(event);
	}
}
