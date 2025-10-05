import type { v3 } from "../../types/ncm";
import type {
	ControlMessage,
	PlaybackStatus,
	RepeatMode,
} from "../../types/smtc";
import { throttle, waitForElement } from "../../utils";
import logger from "../../utils/logger";

import { BaseProvider } from "../provider";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReduxStore(timeoutMs = 10000): Promise<v3.NCMStore> {
	const rootEl = (await waitForElement(
		SELECTORS.REACT_ROOT,
	)) as v3.ReactRootElement;
	if (!rootEl) {
		throw new Error("在页面上找不到 React 根元素");
	}

	const interval = 100;
	let elapsedTime = 0;

	while (elapsedTime < timeoutMs) {
		try {
			// 网易云使用了很多年的react16了，几乎没有可能在不大规模重构的情况下更改下面这个固定的路径，
			// 但是保险起见，失败时可以遍历搜索一下
			const store =
				rootEl._reactRootContainer?._internalRoot?.current?.child?.child
					?.memoizedProps?.store ?? findStoreFromRootElement(rootEl);

			if (store) {
				return store;
			}
		} catch {}

		await delay(interval);
		elapsedTime += interval;
	}

	throw new Error(`在 ${timeoutMs}ms 后仍未找到 Redux Store`);
}

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
		logger.warn("[V3 Provider] #root 元素没有子元素");
		return null;
	}

	const fiberKey = Object.keys(appEl).find(
		(key) =>
			key.startsWith("__reactFiber$") || // >= react 17
			key.startsWith("__reactInternalInstance$"), // < react 17, 网易云使用 react 16.14
	);
	if (!fiberKey) {
		logger.warn("[V3 Provider] 找不到 React Fiber key");
		return null;
	}

	const startNode = (appEl as unknown as Record<string, FiberNode>)[fiberKey];
	if (!startNode) {
		logger.warn("[V3 Provider] 找不到起始 Fiber 节点");
		return null;
	}

	return findReduxStoreInFiberTree(startNode);
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

	NCM_PLAY_MODE_ORDER: "playOrder",
	NCM_PLAY_MODE_LOOP: "playCycle",
	NCM_PLAY_MODE_SHUFFLE: "playRandom",
	NCM_PLAY_MODE_ONE: "playOneCycle",
};

const CHANNEL_EVENTS = new Set<v3.EventName>(["PlayProgress"]);

/**
 * NCM 事件适配器
 */
class NcmEventAdapter {
	private readonly registeredEvt: Set<string>;
	private readonly callbacks: Map<string, Set<v3.EventMap[v3.EventName]>>;

	constructor() {
		this.registeredEvt = new Set<string>();
		this.callbacks = new Map<string, Set<v3.EventMap[v3.EventName]>>();
	}

	public on<E extends v3.EventName>(
		eventName: E,
		callback: v3.EventMap[E],
	): void {
		const namespace = "audioplayer";
		const fullName = `${namespace}.on${eventName}`;

		if (CHANNEL_EVENTS.has(eventName) && channel) {
			try {
				if (!this.registeredEvt.has(fullName)) {
					this.registeredEvt.add(fullName);
					channel.registerCall(fullName, (...args: unknown[]) => {
						this.callbacks?.get(fullName)?.forEach((cb) => {
							(cb as (...args: unknown[]) => void)(...args);
						});
					});
				}
				let callbackSet = this.callbacks.get(fullName);
				if (!callbackSet) {
					callbackSet = new Set();
					this.callbacks.set(fullName, callbackSet);
				}
				callbackSet.add(callback);
			} catch (e) {
				logger.error(`[V3 Provider] 注册 channel 事件 ${eventName} 失败:`, e);
			}
		} else {
			try {
				legacyNativeCmder.appendRegisterCall(eventName, namespace, callback);
			} catch (e) {
				logger.error(
					`[V3 Provider] 注册 legacyNativeCmder 事件 ${eventName} 失败:`,
					e,
				);
			}
		}
	}
}

export default class V3Provider extends BaseProvider {
	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playState: PlaybackStatus = "Paused";
	private reduxStore: v3.NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private readonly dispatchTimelineThrottled: () => void;
	private lastTrackId: number | null = null;
	private lastIsPlaying: boolean | null = null;
	private lastPlayMode: string | undefined = undefined;
	private lastModeBeforeShuffle: string | null = null;
	private isUpdatingFromProvider = false;

	private readonly eventAdapter: NcmEventAdapter;

	private readonly playerActions: {
		resume: () => void;
		pause: () => void;
		next: () => void;
		prev: () => void;
		seek: (timeMS: number) => void;
		switchMode: (mode: string) => void;
	};

	public override ready: Promise<void>;
	private resolveReady!: () => void;

	constructor() {
		super();
		this.eventAdapter = new NcmEventAdapter();

		this.playerActions = {
			resume: () => {
				// triggerScene 应该是用来做数据分析的，大概有 45 种
				// 这里如果刚启动时不提供这个，就会因为 undefined 而报错
				logger.trace("[PlayerActions] Dispatching 'playing/resume'");
				this.reduxStore?.dispatch({
					type: "playing/resume",
					payload: { triggerScene: "track" },
				});
			},
			pause: () => {
				// 网易云点击暂停后会有一两秒的淡出效果，此时还没有暂停
				// 要立刻认为已暂停并更新，不然会有延迟感
				logger.trace("[PlayerActions] Dispatching 'playing/pause'");
				this.reduxStore?.dispatch({ type: "playing/pause" });
				if (this.playState !== "Paused") {
					this.playState = "Paused";
					this.dispatchEvent(
						new CustomEvent("updatePlayState", { detail: this.playState }),
					);
				}
			},
			next: () => {
				logger.trace("[PlayerActions] Dispatching 'playingList/jump2Track'");
				this.reduxStore?.dispatch({
					type: "playingList/jump2Track",
					payload: { flag: 1, type: "call", triggerScene: "track" },
				});
			},
			prev: () => {
				logger.trace("[PlayerActions] Dispatching 'playingList/jump2Track'");
				this.reduxStore?.dispatch({
					type: "playingList/jump2Track",
					payload: { flag: -1, type: "call", triggerScene: "track" },
				});
			},
			seek: (timeMS: number) => {
				logger.trace(
					`[PlayerActions] Dispatching 'playing/setPlayingPosition' to: ${
						timeMS / 1000
					}s`,
				);
				this.reduxStore?.dispatch({
					type: "playing/setPlayingPosition",
					// 一个有误导性的名称，实际上是跳转位置
					payload: { duration: timeMS / 1000 },
				});
			},
			switchMode: (mode: string) => {
				logger.trace(
					`[PlayerActions] Dispatching 'playing/switchPlayingMode' to: ${mode}`,
				);
				// 这里的 triggerScene 用来确保在所有模式切换中都能工作
				// 尤其是心动模式 (虽然我们当前不会切换到心动模式)
				this.reduxStore?.dispatch({
					type: "playing/switchPlayingMode",
					payload: { playingMode: mode, triggerScene: "track" },
				});
			},
		};

		this.ready = new Promise((resolve) => {
			this.resolveReady = resolve;
		});

		this.handleControlEvent = this.handleControlEvent.bind(this);

		this.dispatchTimelineThrottled = throttle(() => {
			this.dispatchEvent(
				new CustomEvent("updateTimeline", {
					detail: {
						currentTime: this.musicPlayProgress,
						totalTime: this.musicDuration,
					},
				}),
			);
		}, CONSTANTS.TIMELINE_THROTTLE_INTERVAL_MS)[0];

		this.initialize().catch((e) => {
			logger.error("[V3 Provider] 初始化失败:", e);
		});
	}

	private async initialize(): Promise<void> {
		try {
			const store = await waitForReduxStore();
			this.reduxStore = store;
			this.unsubscribeStore = this.reduxStore.subscribe(() => {
				this.onStateChanged();
			});
			logger.trace("[V3 Provider] 已订阅 Redux store 更新");
		} catch (error) {
			logger.error("[V3 Provider] 找不到 Redux store:", error);
			return;
		}

		// 注册底层播放器事件和外部控制事件
		this.registerAudioPlayerEvents();
		this.registerControlListeners();

		// 初始化状态
		this.onStateChanged();

		this.resolveReady();
		logger.debug("[V3 Provider] 初始化完成");
	}

	private registerAudioPlayerEvents(): void {
		this.eventAdapter.on("PlayProgress", (audioId: string, progress: number) =>
			this.onPlayProgress(audioId, progress),
		);
		this.eventAdapter.on("PlayState", (audioId: string, state: string) =>
			this.onPlayStateChanged(audioId, state),
		);
	}

	private handleControlEvent(e: CustomEvent<ControlMessage>): void {
		if (this.isUpdatingFromProvider || !this.reduxStore) {
			return;
		}

		this.isUpdatingFromProvider = true;

		try {
			const msg = e.detail;
			logger.info(`[V3 Provider] 处理后端控制事件: ${msg.type}`, msg);

			switch (msg.type) {
				case "Play":
					this.playerActions.resume();
					break;
				case "Pause":
					this.playerActions.pause();
					break;
				case "NextSong":
					this.playerActions.next();
					break;
				case "PreviousSong":
					this.playerActions.prev();
					break;
				case "Seek":
					if (typeof msg.position === "number")
						this.seekToPosition(msg.position);
					break;
				case "ToggleShuffle": {
					const currentMode = this.reduxStore.getState()?.playing?.playingMode;
					const isShuffleOn = currentMode === CONSTANTS.NCM_PLAY_MODE_SHUFFLE;
					const targetMode = isShuffleOn
						? this.lastModeBeforeShuffle || CONSTANTS.NCM_PLAY_MODE_LOOP
						: CONSTANTS.NCM_PLAY_MODE_SHUFFLE;

					if (!isShuffleOn && currentMode) {
						this.lastModeBeforeShuffle = currentMode;
					} else {
						this.lastModeBeforeShuffle = null;
					}
					this.playerActions.switchMode(targetMode);
					break;
				}
				case "ToggleRepeat": {
					const currentMode = this.reduxStore.getState()?.playing?.playingMode;
					let targetMode: string;
					if (currentMode === CONSTANTS.NCM_PLAY_MODE_SHUFFLE) {
						targetMode = CONSTANTS.NCM_PLAY_MODE_ORDER;
						this.lastModeBeforeShuffle = null;
					} else {
						switch (currentMode) {
							case CONSTANTS.NCM_PLAY_MODE_ORDER:
								targetMode = CONSTANTS.NCM_PLAY_MODE_LOOP;
								break;
							case CONSTANTS.NCM_PLAY_MODE_LOOP:
								targetMode = CONSTANTS.NCM_PLAY_MODE_ONE;
								break;
							default:
								targetMode = CONSTANTS.NCM_PLAY_MODE_ORDER;
								break;
						}
					}
					this.playerActions.switchMode(targetMode);
					break;
				}
			}
		} finally {
			Promise.resolve().then(() => {
				this.isUpdatingFromProvider = false;
			});
		}
	}

	private registerControlListeners(): void {
		this.addEventListener("control", this.handleControlEvent);
	}

	private _dispatchSongInfoUpdate(force = false): void {
		const playingInfo = this.reduxStore?.getState().playing;
		if (!playingInfo) return;

		const rawTrackId = playingInfo.resourceTrackId;
		if (!rawTrackId) return;

		const currentTrackId =
			typeof rawTrackId === "number"
				? rawTrackId
				: parseInt(String(rawTrackId), 10);

		if (
			!Number.isNaN(currentTrackId) &&
			currentTrackId !== 0 &&
			(force || currentTrackId !== this.lastTrackId)
		) {
			this.lastTrackId = currentTrackId;
			if (playingInfo.curTrack?.duration) {
				this.musicDuration = playingInfo.curTrack.duration;
			}

			const thumbnailUrl = playingInfo.resourceCoverUrl || "";

			this.dispatchEvent(
				new CustomEvent("updateSongInfo", {
					detail: {
						songName: playingInfo.resourceName || "未知歌名",
						authorName:
							playingInfo.resourceArtists?.map((v) => v.name).join(" / ") || "",
						albumName:
							playingInfo.musicAlbumName ??
							playingInfo.resourceName ??
							"未知专辑",
						thumbnailUrl: thumbnailUrl,
						ncmId: currentTrackId,
					},
				}),
			);
		}
	}

	private _dispatchPlayStateUpdate(force = false): void {
		const isPlayingFromRedux = !!this.reduxStore?.getState().playing?.playing;
		if (!isPlayingFromRedux && this.playState === "Playing") {
			this.lastIsPlaying = false;
			return;
		}
		if (force || this.lastIsPlaying !== isPlayingFromRedux) {
			this.lastIsPlaying = isPlayingFromRedux;
			this.playState = isPlayingFromRedux ? "Playing" : "Paused";
			this.dispatchEvent(
				new CustomEvent("updatePlayState", { detail: this.playState }),
			);
		}
	}

	private _dispatchPlayModeUpdate(force = false): void {
		const newNcmMode = this.reduxStore?.getState().playing?.playingMode;
		if (force || this.lastPlayMode !== newNcmMode) {
			this.lastPlayMode = newNcmMode || undefined;

			let isShuffling = newNcmMode === CONSTANTS.NCM_PLAY_MODE_SHUFFLE;
			let repeatMode: RepeatMode = "None";

			switch (newNcmMode) {
				case CONSTANTS.NCM_PLAY_MODE_SHUFFLE:
					isShuffling = true;
					repeatMode = "List";
					break;
				case CONSTANTS.NCM_PLAY_MODE_ORDER:
					isShuffling = false;
					repeatMode = "None";
					break;
				case CONSTANTS.NCM_PLAY_MODE_LOOP:
					isShuffling = false;
					repeatMode = "List";
					break;
				case CONSTANTS.NCM_PLAY_MODE_ONE:
					isShuffling = false;
					repeatMode = "Track";
					break;
			}

			this.dispatchEvent(
				new CustomEvent("updatePlayMode", {
					detail: { isShuffling, repeatMode },
				}),
			);
		}
	}

	private _dispatchTimelineUpdate(): void {
		this.dispatchEvent(
			new CustomEvent("updateTimeline", {
				detail: {
					currentTime: this.musicPlayProgress,
					totalTime: this.musicDuration,
				},
			}),
		);
	}

	private async onStateChanged(): Promise<void> {
		if (!this.reduxStore) return;

		this._dispatchPlayModeUpdate();
		this._dispatchSongInfoUpdate();
		this._dispatchPlayStateUpdate();
		const playingInfo = this.reduxStore.getState().playing;
		if (playingInfo?.progress !== undefined && this.musicPlayProgress === 0) {
			this.musicPlayProgress = Math.floor(playingInfo.progress * 1000);
			this.dispatchTimelineThrottled();
		}
	}

	private onPlayProgress(_audioId: string, progress: number): void {
		this.musicPlayProgress = (progress * 1000) | 0;
		this.dispatchTimelineThrottled();
	}

	private onPlayStateChanged(_audioId: string, stateInfo: string): void {
		let newPlayState: PlaybackStatus = this.playState;

		const parts = stateInfo.split("|");
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
					logger.warn(`[V3 Provider] 未知的播放状态: ${stateKeyword}`);
					break;
			}
		} else {
			logger.warn(`[V3 Provider] 意外的播放状态: ${stateInfo}`);
		}

		if (this.playState !== newPlayState) {
			this.playState = newPlayState;
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("updatePlayState", {
					detail: this.playState,
				}),
			);
		}
	}

	public seekToPosition(timeMS: number): void {
		if (!this.reduxStore) {
			logger.error("[V3 Provider] Redux store 不可用, 无法跳转.");
			return;
		}

		this.musicPlayProgress = timeMS;
		this._dispatchTimelineUpdate();
		this.playerActions.seek(timeMS);
	}

	public override forceDispatchFullState(): void {
		if (!this.reduxStore?.getState().playing || !this.lastTrackId) {
			logger.warn("[V3 Provider] 没有缓存的状态可以分发。");
			return;
		}
		this.lastIsPlaying = null;
		this._dispatchSongInfoUpdate(true);
		this._dispatchPlayStateUpdate(true);
		this._dispatchPlayModeUpdate(true);
		this._dispatchTimelineUpdate();
	}

	public override dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.removeEventListener("control", this.handleControlEvent);
		logger.debug("[V3 Provider] Disposed.");
	}
}
