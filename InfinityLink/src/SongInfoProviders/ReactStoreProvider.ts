import type {
	Artist,
	AudioLoadInfo,
	NCMStore,
	NcmEventMap,
	NcmEventName,
	ReactRootElement,
} from "../types/ncm-internal";
import type { PlaybackStatus, RepeatMode } from "../types/smtc";
import { throttle, waitForElement } from "../utils";
import logger from "../utils/logger";
import { BaseProvider } from "./BaseProvider";

async function waitForReduxStore(timeoutMs = 10000): Promise<NCMStore> {
	const rootEl = (await waitForElement(
		SELECTORS.REACT_ROOT,
	)) as ReactRootElement;
	if (!rootEl) {
		throw new Error("React root element (#root) not found on the page.");
	}

	return new Promise((resolve, reject) => {
		const interval = 100;
		let elapsedTime = 0;

		const checkStore = () => {
			const store =
				rootEl._reactRootContainer?._internalRoot?.current?.child?.child
					?.memoizedProps?.store;

			if (store) {
				resolve(store);
			} else if (elapsedTime >= timeoutMs) {
				reject(new Error(`waitForReduxStore timed out after ${timeoutMs}ms.`));
			} else {
				elapsedTime += interval;
				setTimeout(checkStore, interval);
			}
		};

		checkStore();
	});
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

	PROGRESS_JUMP_THRESHOLD_S: 1.5,

	// React 内部 props 属性的前缀
	REACT_PROPS_PREFIX: "__reactProps$",

	NCM_PLAY_MODE_ORDER: "playOrder",
	NCM_PLAY_MODE_LOOP: "playCycle",
	NCM_PLAY_MODE_SHUFFLE: "playRandom",
	NCM_PLAY_MODE_ONE: "playOneCycle",
};

/**
 * NCM 事件适配器
 */
class NcmEventAdapter {
	private readonly registeredEvt: Set<string>;
	private readonly callbacks: Map<string, Set<NcmEventMap[NcmEventName]>>;

	constructor() {
		this.registeredEvt = new Set<string>();
		this.callbacks = new Map<string, Set<NcmEventMap[NcmEventName]>>();
	}

	public on<E extends NcmEventName>(
		eventName: E,
		callback: NcmEventMap[E],
	): void {
		const namespace = "audioplayer";
		try {
			const fullName = `${namespace}.on${eventName}`;
			if (!this.registeredEvt.has(fullName)) {
				this.registeredEvt.add(fullName);
				channel.registerCall(fullName, (...args: unknown[]) => {
					// logger.debug(
					// 	`[NcmEventAdapter] Received event '${fullName}' with args:`,
					// 	args,
					// );
					this.callbacks?.get(fullName)?.forEach((cb) => {
						(cb as (...args: unknown[]) => void)(...args);
					});
				});
				logger.debug(`[NcmEventAdapter] Event '${fullName}' registered.`);
			}

			let callbackSet = this.callbacks.get(fullName);

			if (!callbackSet) {
				callbackSet = new Set();
				this.callbacks.set(fullName, callbackSet);
			}

			callbackSet.add(callback);
		} catch (e) {
			logger.error(`[React Store Provider] 注册事件 ${eventName}失败:`, e);
		}
	}
}

export class ReactStoreProvider extends BaseProvider {
	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playState: PlaybackStatus = "Paused";
	private reduxStore: NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private lastProgress = 0;
	private readonly dispatchTimelineThrottled: () => void;
	private lastTrackId: string | null = null;
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

	public ready: Promise<void>;
	private resolveReady!: () => void;

	public onPlayModeChange:
		| ((detail: { isShuffling: boolean; repeatMode: RepeatMode }) => void)
		| null = null;

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
			logger.error("[React Store Provider] 初始化失败:", e);
		});
	}

	private async initialize(): Promise<void> {
		logger.trace("[React Store Provider] Initializing...");

		try {
			const store = await waitForReduxStore();
			logger.trace("[React Store Provider] Redux store found.");
			this.reduxStore = store;
			this.unsubscribeStore = this.reduxStore.subscribe(() => {
				this.onStateChanged();
			});
			logger.trace("[React Store Provider] Subscribed to Redux store updates.");
		} catch (error) {
			logger.error("[React Store Provider] Could not find Redux store:", error);
			return;
		}

		// 注册底层播放器事件和外部控制事件
		this.registerAudioPlayerEvents();
		this.registerControlListeners();

		// 初始化状态
		this.onStateChanged();

		this.resolveReady();
		logger.debug("[React Store Provider] Initialization complete.");
	}

	private registerAudioPlayerEvents(): void {
		logger.debug("[React Store Provider] Registering audio player events...");
		this.eventAdapter.on("Load", (audioId: string, info: AudioLoadInfo) =>
			this.onMusicLoad(audioId, info),
		);
		this.eventAdapter.on("PlayProgress", (audioId: string, progress: number) =>
			this.onPlayProgress(audioId, progress),
		);
		this.eventAdapter.on(
			"PlayState",
			(audioId: string, state: string | number) =>
				this.onPlayStateChanged(audioId, state),
		);
	}

	private handleControlEvent(e: CustomEvent): void {
		if (this.isUpdatingFromProvider || !this.reduxStore) {
			return;
		}

		const msg = e.detail;
		logger.info(
			`[React Store Provider] Handling control event: ${msg.type}`,
			msg,
		);

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
				if (typeof msg.position === "number") this.seekToPosition(msg.position);
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
	}

	private registerControlListeners(): void {
		logger.debug("[React Store Provider] Registering control event listeners.");
		this.addEventListener("control", this.handleControlEvent);
	}

	private _dispatchSongInfoUpdate(force = false): void {
		const playingInfo = this.reduxStore?.getState().playing;
		if (!playingInfo) return;

		const currentTrackId = String(playingInfo.resourceTrackId || "").trim();
		if (
			force ||
			(currentTrackId &&
				currentTrackId !== "0" &&
				currentTrackId !== this.lastTrackId)
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
							playingInfo.resourceArtists
								?.map((v: Artist) => v.name)
								.join(" / ") || "",
						albumName: playingInfo.musicAlbumName ?? playingInfo.resourceName,
						thumbnailUrl: thumbnailUrl,
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

			this.isUpdatingFromProvider = true;
			setTimeout(() => {
				this.isUpdatingFromProvider = false;
			}, 100);

			this.onPlayModeChange?.({ isShuffling, repeatMode });
			this.dispatchEvent(
				new CustomEvent("updatePlayMode", { detail: newNcmMode }),
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
			logger.debug(
				`[React Store Provider] Initializing progress: ${playingInfo.progress * 1000}ms`,
			);
			this.musicPlayProgress = Math.floor(playingInfo.progress * 1000);
			this.dispatchTimelineThrottled();
		}
	}

	private onMusicLoad(audioId: string, info: AudioLoadInfo): void {
		logger.debug(
			`[React Store Provider] Event 'Load' received for audioId: ${audioId}. Duration: ${info.duration}s`,
		);
		this.musicDuration = (info.duration * 1000) | 0;
	}

	private onPlayProgress(_audioId: string, progress: number): void {
		// 忽略因 seek 操作导致的进度大幅跳跃
		if (
			Math.abs(progress - this.lastProgress) >
				CONSTANTS.PROGRESS_JUMP_THRESHOLD_S &&
			progress > 0.01
		) {
			logger.debug(
				`[React Store Provider] Progress jump detected and ignored. From ${this.lastProgress} to ${progress}.`,
			);
			this.lastProgress = progress;
			return;
		}
		this.lastProgress = progress;
		this.musicPlayProgress = (progress * 1000) | 0;
		this.dispatchTimelineThrottled();
	}

	private onPlayStateChanged(
		_audioId: string,
		stateInfo: string | number,
	): void {
		let newPlayState: PlaybackStatus = this.playState;
		if (typeof stateInfo === "string") {
			const state = stateInfo.split("|")[1];
			if (state === "pause") newPlayState = "Paused";
			else if (state === "resume") newPlayState = "Playing";
		}
		if (this.playState !== newPlayState) {
			this.playState = newPlayState;
			this.dispatchEvent(
				new CustomEvent("updatePlayState", { detail: this.playState }),
			);
		}
	}

	public seekToPosition(timeMS: number): void {
		if (!this.reduxStore) {
			logger.warn(
				"[React Store Provider] Redux store is not available, cannot seek.",
			);
			return;
		}

		this.musicPlayProgress = timeMS;
		this.dispatchEvent(
			new CustomEvent("updateTimeline", {
				detail: {
					currentTime: this.musicPlayProgress,
					totalTime: this.musicDuration,
				},
			}),
		);

		this.playerActions.seek(timeMS);
	}

	public forceDispatchFullState(): void {
		logger.debug(
			"[React Store Provider] Forcing dispatch of full current state.",
		);
		if (!this.reduxStore?.getState().playing || !this.lastTrackId) {
			logger.warn("[React Store Provider] 没有缓存的状态可以分发。");
			return;
		}
		this.lastIsPlaying = null;
		this._dispatchSongInfoUpdate(true);
		this._dispatchPlayStateUpdate(true);
		this._dispatchPlayModeUpdate(true);
		this._dispatchTimelineUpdate();

		logger.trace("[React Store Provider] Full state dispatch complete.");
	}

	public override dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
			logger.trace("[React Store Provider] Unsubscribed from Redux store.");
		}
		this.removeEventListener("control", this.handleControlEvent);
		logger.debug("[React Store Provider] Disposed.");
	}
}
