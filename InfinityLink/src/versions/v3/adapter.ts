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
	NcmEventAdapter,
	type ParsedEventMap,
	throttle,
	type WebpackRequire,
	waitForElement,
} from "../../utils";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap } from "../adapter";
import { PlayModeController } from "../playModeController";
import { type AudioPlayer, AudioPlayerWrapper } from "./audioPlayerWrapper";

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
	private audioPlayerWrapper: AudioPlayerWrapper | null = null;
	private isInternalLoggingEnabled = false;
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
			() => this.dispatchTimelineUpdateNow(),
			CONSTANTS.TIMELINE_THROTTLE_INTERVAL_MS,
		);
	}

	public async initialize(): Promise<Result<void, NcmAdapterError>> {
		const require = await getWebpackRequire();

		this.initializeAndPatchLogger(require);
		this.initializeAudioPlayer(require);
		this.initializeEventAdapter(require);
		this.initializeStorage(require);

		const store = this.findReduxStoreFromDva(require);

		if (store) {
			this.reduxStore = store;
			logger.debug("通过 dva-tool 获取到 Redux Store", "Adapter V3");
		} else {
			logger.warn("回退到 Fiber Tree 遍历方案来寻找 Redux Store", "Adapter V3");
			const storeResult = await waitForReduxStore();
			if (storeResult.isErr()) {
				return err(storeResult.error);
			}
			this.reduxStore = storeResult.value;
		}

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

	private initializeAndPatchLogger(require: WebpackRequire): void {
		try {
			type LoggerMethod = (...args: unknown[]) => void;
			type PatchedLoggerMethod = LoggerMethod & { __isPatched?: boolean };
			type LoggerModule = {
				[level in
					| "debug"
					| "log"
					| "info"
					| "warn"
					| "error"
					| "crash"]: LoggerMethod;
			};
			type LoggerContainer = { b: LoggerModule };

			type PatchableConsoleLevel = "debug" | "log" | "info" | "warn" | "error";

			const loggerContainer = findModule<LoggerContainer>(
				require,
				(exports: unknown): exports is LoggerContainer =>
					!!exports &&
					typeof exports === "object" &&
					"b" in exports &&
					!!(exports as { b: unknown }).b &&
					typeof (exports as { b: object }).b === "object" &&
					"info" in (exports as { b: object }).b &&
					typeof (exports as { b: { info: unknown } }).b.info === "function",
			);

			if (!loggerContainer) {
				logger.warn("未找到内部日志模块，跳过补丁", "Adapter V3");
				return;
			}

			const loggerModule = loggerContainer.b;
			const levelsToPatch: PatchableConsoleLevel[] = [
				"debug",
				"log",
				"info",
				"warn",
				"error",
			];

			for (const level of levelsToPatch) {
				const originalMethod = loggerModule[level] as PatchedLoggerMethod;

				if (originalMethod.__isPatched) {
					continue;
				}

				const newMethod: PatchedLoggerMethod = (...args: unknown[]) => {
					if (this.isInternalLoggingEnabled) {
						const [modName, ...restArgs] = args;

						const pluginPart = "NCM Internal";
						const sourcePart = String(modName);
						const badgePluginCss = [
							"color: white",
							"background-color: #ff3f41",
							"padding: 1px 4px",
							"border-radius: 3px 0 0 3px",
							"font-weight: bold",
						].join(";");
						const badgeSourceCss = [
							"color: white",
							"background-color: #5a6268",
							"padding: 1px 4px",
							"border-radius: 0 3px 3px 0",
						].join(";");

						console[level](
							`%c${pluginPart}%c${sourcePart}`,
							badgePluginCss,
							badgeSourceCss,
							...restArgs,
						);
					}
					return originalMethod.apply(loggerModule, args);
				};
				newMethod.__isPatched = true;

				loggerModule[level] = newMethod;
			}
		} catch (e) {
			logger.error("给内部日志模块打补丁时发生错误:", "Adapter V3", e);
		}
	}

	/**
	 * 用网易云自己的 dva-tool 模块获取 Redux Store
	 */
	private findReduxStoreFromDva(require: WebpackRequire): v3.NCMStore | null {
		try {
			type DvaApp = {
				_store: v3.NCMStore;
			};
			type DvaToolModule = {
				a: {
					inited: boolean;
					app: DvaApp | null;
					getStore(): v3.ReduxState;
					getDispatch(): v3.NCMStore["dispatch"];
				};
			};

			const dvaModule = findModule<DvaToolModule>(
				require,
				(exports: unknown): exports is DvaToolModule => {
					return (
						!!exports &&
						typeof exports === "object" &&
						"a" in exports &&
						!!(exports as { a: unknown }).a &&
						typeof (exports as { a: object }).a === "object" &&
						"getStore" in (exports as { a: object }).a &&
						typeof (exports as { a: { getStore: unknown } }).a.getStore ===
							"function"
					);
				},
			);

			if (
				dvaModule?.a.inited &&
				dvaModule.a.app?._store &&
				typeof dvaModule.a.app._store.subscribe === "function"
			) {
				return dvaModule.a.app._store;
			}
		} catch (e) {
			logger.error("通过 dva-tool 寻找 Store 时发生错误:", "Adapter V3", e);
		}

		return null;
	}

	private initializeAudioPlayer(require: WebpackRequire): void {
		try {
			type AudioPlayerModule = { AudioPlayer: AudioPlayer };

			const audioPlayerModule = findModule<AudioPlayerModule>(
				require,
				(exports: unknown): exports is AudioPlayerModule => {
					if (typeof exports !== "object" || exports === null) {
						return false;
					}
					if (!("AudioPlayer" in exports)) {
						return false;
					}
					const audioPlayerProp = (exports as { AudioPlayer: unknown })
						.AudioPlayer;
					if (typeof audioPlayerProp !== "object" || audioPlayerProp === null) {
						return false;
					}
					return (
						"subscribePlayStatus" in audioPlayerProp &&
						typeof (audioPlayerProp as { subscribePlayStatus: unknown })
							.subscribePlayStatus === "function"
					);
				},
			);
			if (audioPlayerModule) {
				this.audioPlayerWrapper = new AudioPlayerWrapper(
					audioPlayerModule.AudioPlayer,
				);
			} else {
				logger.warn("找不到 AudioPlayer 模块", "Adapter V3");
			}
		} catch (error) {
			logger.error("获取 AudioPlayer 模块失败:", "Adapter V3", error);
		}
	}

	/**
	 * 网易云 v3 内部存在两个 OrpheusCommand (legacyNativeCmder) 实例：
	 * 1. 一个是暴露在全局的 `window.legacyNativeCmder`
	 * 2. 另一个是未暴露的、供内部核心模块（如 AudioPlayer）使用的私有实例 (名为 Bridge)
	 *
	 * 核心 UI 组件（如进度条）的事件监听是注册在内部实例上的。如果我们使用全局实例去注册
	 * 监听器（特别是 PlayProgress 和 Seek），全局的监听器会覆盖掉 Bridge 中的监听器 (参见
	 * native.ts 中的实现)，导致进度条静止等怪异问题
	 *
	 * 因此，我们需要：
	 * - 先通过 Webpack 模块查找获取到内部的 `Bridge` 实例
	 * - 如果查找失败，再回退到使用全局的 `window.legacyNativeCmder` 作为备用方案 (通常会导致问题)
	 */
	private initializeEventAdapter(require: WebpackRequire): void {
		type BridgeContainerModule = { Bridge: OrpheusCommand };

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
	}

	private initializeStorage(require: WebpackRequire): void {
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
	}

	public dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.unregisterNcmEvents();
		this.eventAdapter.dispose();
		this.audioPlayerWrapper?.dispose();

		logger.debug("Disposed.", "Adapter V3");
	}

	public hasNativeSmtcSupport(): boolean {
		return this.audioPlayerWrapper?.hasSmtcSupport() ?? false;
	}

	public setNativeSmtc(enabled: boolean): void {
		this.audioPlayerWrapper?.setSmtcEnabled(enabled);
		logger.info(`已${enabled ? "启用" : "禁用"}内置的 SMTC 功能`, "Adapter V3");
	}

	public setInternalLogging(enabled: boolean): void {
		this.isInternalLoggingEnabled = enabled;
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
		return this.playState;
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
		this.reduxStore?.dispatch({
			type: "playing/resume",
			payload: { triggerScene: "track" },
		});
	}

	public pause(): void {
		if (this.playState !== "Paused") {
			this.playState = "Paused";
			this.lastIsPlaying = false;
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: "Paused",
				}),
			);
		}
		this.reduxStore?.dispatch({ type: "playing/pause" });
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

		if (this.lastIsPlaying === null) {
			const isPlaying = playingInfo.playingState === 2;
			this.lastIsPlaying = isPlaying;
			this.playState = isPlaying ? "Playing" : "Paused";
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: this.playState,
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
			this.dispatchTimelineUpdateNow();
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
		// 跳转同时也会触发progress事件，所以在这里就不派发更新了
		// this.dispatchTimelineUpdateNow();
	};

	private readonly onPlayStateChanged = (
		e: ParsedEventMap["playStateChange"],
	): void => {
		const newPlayState = e.detail;
		if (this.playState !== newPlayState) {
			this.playState = newPlayState;
			this.lastIsPlaying = newPlayState === "Playing";

			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: this.playState,
				}),
			);
		}
	};

	private dispatchTimelineUpdateNow(): void {
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
