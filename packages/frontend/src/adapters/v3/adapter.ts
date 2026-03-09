/** biome-ignore-all lint/complexity/useLiteralKeys: 和 ts 配置 noPropertyAccessFromIndexSignature 冲突 */
import { feature } from "bun:bundle";
import type { PlayMode, SongInfo } from "@/types/backend";
import {
	DomElementNotFoundError,
	InconsistentStateError,
	ReduxStoreNotFoundError,
} from "@/types/errors";
import type { OrpheusCommand } from "@/types/global";
import type { AudioDataInfo, v3 } from "@/types/ncm";
import {
	findModule,
	getWebpackRequire,
	NcmEventAdapter,
	type ParsedEventMap,
	type WebpackRequire,
	waitForElement,
} from "@/utils";
import logger from "@/utils/logger";
import { BaseNcmAdapter } from "../baseAdapter";
import { type AudioPlayer, AudioPlayerWrapper } from "./audioPlayerWrapper";
import { patchInternalLogger } from "./patchInternalLogger";

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

async function waitForReduxStore(timeoutMs = 10000): Promise<v3.NCMStore> {
	const rootEl = (await waitForElement(
		SELECTORS.REACT_ROOT,
	)) as v3.ReactRootElement;
	if (!rootEl) {
		throw new DomElementNotFoundError(
			`找不到 React 根元素 (${SELECTORS.REACT_ROOT})`,
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
				return store;
			}
		} catch (e) {
			logger.info("Polling for Redux store failed once:", "Adapter V3", e);
		}

		await delay(interval);
		elapsedTime += interval;
	}

	throw new ReduxStoreNotFoundError(`在 ${timeoutMs}ms 后仍未找到 Redux Store`);
}

/**
 * CSS 选择器常量
 */
const SELECTORS = {
	// React 应用根节点
	REACT_ROOT: "#root",
};

export class V3NcmAdapter extends BaseNcmAdapter {
	private reduxStore: v3.NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private eventAdapter!: NcmEventAdapter;
	private storageModule: v3.NcmStorageModule | null = null;
	private audioPlayerWrapper: AudioPlayerWrapper | null = null;
	private isInternalLoggingEnabled = false;
	private hasRestoredInitialState = false;
	private ignoreNextZeroProgressEvent = false;

	private lastTrackId: string | null = null;
	private lastIsPlaying: boolean | null = null;
	private lastPlayMode: string | undefined = undefined;

	public async initialize(): Promise<void> {
		const require = await getWebpackRequire();

		if (feature("DEV")) {
			patchInternalLogger(require, () => this.isInternalLoggingEnabled);
		}
		this.initializeAudioPlayer(require);
		this.initializeEventAdapter(require);
		this.initializeStorage(require);

		const store = this.findReduxStoreFromDva(require);

		if (store) {
			this.reduxStore = store;
			logger.debug("通过 dva-tool 获取到 Redux Store", "Adapter V3");
		} else {
			logger.warn("回退到 Fiber Tree 遍历方案来寻找 Redux Store", "Adapter V3");
			this.reduxStore = await waitForReduxStore();
		}

		if (feature("DEV")) {
			window.infstore = this.reduxStore;
		}

		this.unsubscribeStore = this.reduxStore.subscribe(() =>
			this.onStateChanged(),
		);

		this.registerNcmEvents();
		this.onStateChanged();
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
						!!exports.a &&
						typeof exports.a === "object" &&
						"getStore" in exports.a &&
						typeof exports.a.getStore === "function"
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
					const audioPlayerProp = exports.AudioPlayer;
					if (typeof audioPlayerProp !== "object" || audioPlayerProp === null) {
						return false;
					}
					return (
						"subscribePlayStatus" in audioPlayerProp &&
						typeof audioPlayerProp.subscribePlayStatus === "function"
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
				const bridgeCandidate = exports.Bridge;
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
					typeof exports.b !== "object" ||
					exports.b === null
				) {
					return false;
				}

				const b = exports.b;

				if (
					!("lastPlaying" in b) ||
					typeof b["lastPlaying"] !== "object" ||
					b["lastPlaying"] === null
				) {
					return false;
				}

				const lastPlaying = b["lastPlaying"] as Record<string, unknown>;

				return "get" in lastPlaying && typeof lastPlaying["get"] === "function";
			},
		);

		this.storageModule = storageContainer ? storageContainer.b : null;

		if (!this.storageModule) {
			logger.warn("未找到内部存储模块", "Adapter V3");
		} else if (feature("DEV")) {
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

	public setInternalLogging(enabled: boolean): void {
		if (feature("DEV")) {
			this.isInternalLoggingEnabled = enabled;
		}
	}

	protected onAudioDataSubscriptionStarted(): void {
		this.audioPlayerWrapper?.setPluginAudioDataCallback(this.onAudioDataUpdate);
	}

	protected onAudioDataSubscriptionEnded(): void {
		this.audioPlayerWrapper?.setPluginAudioDataCallback(undefined);
	}

	public getCurrentSongInfo(): SongInfo | null {
		const state = this.reduxStore?.getState();
		const playingInfo = state?.playing;

		if (playingInfo?.resourceType === "voice") {
			const vinylInfo = state?.["page:vinylPage"];
			const currentVoice = vinylInfo?.currentVoice;

			if (
				!currentVoice ||
				String(currentVoice.id) !== String(playingInfo.onlineResourceId)
			) {
				throw new InconsistentStateError(
					"播客信息尚未同步 (page:vinylPage 与 playing state 不一致)",
				);
			}

			const voiceId = parseInt(currentVoice.id, 10);
			if (Number.isNaN(voiceId) || voiceId === 0) {
				return null;
			}

			let duration = 0;
			if (typeof currentVoice.duration === "number") {
				duration = currentVoice.duration;
			}

			return {
				songName: currentVoice.name || "未知播客",
				authorName:
					currentVoice.track?.artists?.map((v) => v.name).join(" / ") ||
					"未知主播",
				albumName: currentVoice.radio?.name || "未知播单",
				cover: currentVoice.coverUrl ? { url: currentVoice.coverUrl } : null,
				ncmId: voiceId,
				duration: duration > 0 ? duration : undefined,
			};
		}

		if (!playingInfo?.resourceTrackId) {
			return null;
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
			return null;
		}

		let currentTrackId: number;
		const trackIdStr = String(trackIdSource);

		if (/^\d+$/.test(trackIdStr) && trackIdStr !== "0") {
			currentTrackId = parseInt(trackIdStr, 10);
		} else {
			currentTrackId = 0;
		}

		if (Number.isNaN(currentTrackId)) {
			return null;
		}

		const coverUrl = playingInfo.resourceCoverUrl || "";

		let duration = 0;
		if (playingInfo.curTrack?.duration) {
			duration = playingInfo.curTrack.duration;
		}

		return {
			songName: playingInfo.resourceName || "未知歌名",
			authorName:
				playingInfo.resourceArtists?.map((v) => v.name).join(" / ") ||
				"未知艺术家",
			albumName: albumName,
			cover: coverUrl ? { url: coverUrl } : null,
			ncmId: currentTrackId,
			duration: duration > 0 ? duration : undefined,
		};
	}

	public getPlayMode(): PlayMode {
		const newNcmMode = this.reduxStore?.getState().playing?.playingMode;
		if (newNcmMode) {
			return toCanonicalPlayMode(newNcmMode);
		}
		return { isShuffling: false, repeatMode: "None" };
	}

	public play(): void {
		this.reduxStore?.dispatch({
			type: "playing/resume",
			payload: { triggerScene: "desktopLyric" },
		});
	}

	public pause(): void {
		if (this.playState !== "Paused") {
			this.playState = "Paused";
			this.lastIsPlaying = false;
			this.dispatch("playStateChange", "Paused");
		}
		this.reduxStore?.dispatch({
			type: "playing/pause",
			payload: { triggerScene: "desktopLyric" },
		});
	}

	public nextSong(): void {
		this.reduxStore?.dispatch({
			type: "playingList/jump2Track",
			payload: { flag: 1, type: "call", triggerScene: "hotKey" },
		});
	}

	public previousSong(): void {
		this.reduxStore?.dispatch({
			type: "playingList/jump2Track",
			payload: { flag: -1, type: "call", triggerScene: "hotKey" },
		});
	}

	public seekTo(positionMs: number): void {
		this.reduxStore?.dispatch({
			type: "playing/setPlayingPosition",
			// 一个有误导性的名称，实际上是跳转位置
			payload: { duration: positionMs / 1000 },
		});
	}

	protected applyInternalPlayMode(mode: PlayMode): void {
		if (!this.reduxStore) return;
		const targetNcmMode = fromCanonicalPlayMode(mode);

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			payload: { playingMode: targetNcmMode, triggerScene: "sysTray" },
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

	private onStateChanged(): void {
		if (!this.reduxStore) return;
		const state = this.reduxStore.getState();
		const playingInfo = state.playing;

		const currentRawTrackId = playingInfo.resourceTrackId;
		if (currentRawTrackId && currentRawTrackId !== this.lastTrackId) {
			let songInfo: SongInfo | null;
			try {
				songInfo = this.getCurrentSongInfo();
			} catch (e) {
				if (e instanceof InconsistentStateError) {
					return;
				}
				throw e;
			}

			this.lastTrackId = currentRawTrackId;

			this.processSongInfoChange(songInfo);

			if (!this.hasRestoredInitialState) {
				this.hasRestoredInitialState = true;
				this.restoreLastPlaybackState();
			}
		}

		if (this.lastIsPlaying === null) {
			const isPlaying = playingInfo.playingState === 2;
			this.lastIsPlaying = isPlaying;
			this.updatePlayState(isPlaying ? "Playing" : "Paused");
		}

		const playMode = playingInfo?.playingMode;
		if (playMode && playMode !== this.lastPlayMode) {
			this.lastPlayMode = playMode;
			this.dispatch("playModeChange", this.getPlayMode());
		}

		const newVolume = playingInfo?.playingVolume;
		if (typeof newVolume === "number" && newVolume !== this.volume) {
			this.updateVolume(newVolume, newVolume === 0);
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

		this.updateTimeline(e.detail);
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
		this.lastIsPlaying = newPlayState === "Playing";
		this.updatePlayState(newPlayState);
	};

	private readonly onAudioDataUpdate = (data: AudioDataInfo): void => {
		this.dispatch("audioDataUpdate", data);
	};
}
