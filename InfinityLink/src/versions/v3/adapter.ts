import { err, ok, type Result } from "neverthrow";
import {
	DomElementNotFoundError,
	type NcmAdapterError,
	ReduxStoreNotFoundError,
	SongNotFoundError,
	TimelineNotAvailableError,
} from "../../types/errors";
import type { v3 } from "../../types/ncm";
import type {
	PlaybackStatus,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "../../types/smtc";
import {
	calculateNextRepeatMode,
	calculateNextShuffleMode,
	findModule,
	getWebpackRequire,
	resizeImageUrl,
	throttle,
	waitForElement,
} from "../../utils";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap, PlayModeInfo } from "../adapter";

const NCM_PLAY_MODES = {
	SHUFFLE: "playRandom",
	LOOP: "playCycle",
	ONE_LOOP: "playOneCycle",
	ORDER: "playOrder",
	AI: "playAi",
	// 直接切换到 FM 播放模式会让网易云进入一个不一致的状态
	// 如果要进入 FM 模式，应该用别的方式
	FM: "playFm",
} as const;

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
		logger.warn("[Adapter V3] #root 元素没有子元素");
		return null;
	}

	const fiberKey = Object.keys(appEl).find(
		(key) =>
			key.startsWith("__reactFiber$") || // >= react 17
			key.startsWith("__reactInternalInstance$"), // < react 17, 网易云使用 react 16.14
	);
	if (!fiberKey) {
		logger.warn("[Adapter V3] 找不到 React Fiber key");
		return null;
	}

	const startNode = (appEl as unknown as Record<string, FiberNode>)[fiberKey];
	if (!startNode) {
		logger.warn("[Adapter V3] 找不到起始 Fiber 节点");
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
			logger.info("[Adapter V3] Polling for Redux store failed once:", e);
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

/**
 * 这个事件非常莫名其妙，使用 `appendRegisterCall` 来注册它会导致 UI 进度条静止
 *
 * 但 `audioPlayer.subscribePlayStatus` 底层也使用 `appendRegisterCall`，
 * 它却可以工作
 *
 * 用 `channel.registerCall` 也可以正确工作，尽管它会覆盖所有之前注册的监听器，
 * 理论上比 `appendRegisterCall` 更具破坏性，并且没有清理方法
 *
 * 并且如果有其它插件 (比如 AMLL 的 WS 插件) 也用 `channel.registerCall` 来注册，
 * 我们注册的监听器就会被覆盖了。所以这个事件只作为 `audioPlayer.subscribePlayStatus`
 * 无法工作的情况下，备用的获取时间轴的方式
 */
const CHANNEL_EVENTS = new Set<v3.EventName>(["PlayProgress"]);

/**
 * NCM 事件适配器
 */
class NcmEventAdapter {
	private readonly registeredLegacyEvents = new Map<
		string,
		Set<v3.EventMap[v3.EventName]>
	>();

	private readonly callbacks = new Map<
		string,
		Set<v3.EventMap[v3.EventName]>
	>();

	public on<E extends v3.EventName>(
		eventName: E,
		callback: v3.EventMap[E],
	): void {
		const namespace = "audioplayer";
		const fullName = `${namespace}.on${eventName}`;

		let callbackSet = this.callbacks.get(fullName);
		if (!callbackSet) {
			callbackSet = new Set();
			this.callbacks.set(fullName, callbackSet);
		}
		callbackSet.add(callback);

		if (CHANNEL_EVENTS.has(eventName) && window.channel) {
			try {
				window.channel.registerCall(fullName, (...args: unknown[]) => {
					this.callbacks?.get(fullName)?.forEach((cb) => {
						(cb as (...args: unknown[]) => void)(...args);
					});
				});
			} catch (e) {
				logger.error(`[Adapter V3] 注册 channel 事件 ${eventName} 失败:`, e);
			}
		} else {
			if (!this.registeredLegacyEvents.has(fullName)) {
				const legacyCallbackSet = new Set<v3.EventMap[v3.EventName]>();
				this.registeredLegacyEvents.set(fullName, legacyCallbackSet);

				const stub = (...args: unknown[]) => {
					this.callbacks?.get(fullName)?.forEach((cb) => {
						(cb as (...args: unknown[]) => void)(...args);
					});
				};
				legacyCallbackSet.add(stub);

				try {
					legacyNativeCmder.appendRegisterCall(eventName, namespace, stub);
				} catch (e) {
					logger.error(
						`[Adapter V3] 注册 legacyNativeCmder 事件 ${eventName} 失败:`,
						e,
					);
				}
			}
		}
	}

	public off<E extends v3.EventName>(
		eventName: E,
		callback: v3.EventMap[E],
	): void {
		const namespace = "audioplayer";
		const fullName = `${namespace}.on${eventName}`;

		const callbackSet = this.callbacks.get(fullName);
		if (callbackSet) {
			callbackSet.delete(callback);
		}

		const legacyCallbackSet = this.registeredLegacyEvents.get(fullName);
		if (legacyCallbackSet && callbackSet?.size === 0) {
			legacyCallbackSet.forEach((stub) => {
				legacyNativeCmder.removeRegisterCall(eventName, namespace, stub);
			});
			this.registeredLegacyEvents.delete(fullName);
			this.callbacks.delete(fullName);
		}
	}
}

export class V3NcmAdapter extends EventTarget implements INcmAdapter {
	private reduxStore: v3.NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private audioPlayer: v3.AudioPlayer | null = null;
	private readonly eventAdapter: NcmEventAdapter;

	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playState: PlaybackStatus = "Paused";
	private lastTrackId: number | null = null;
	private lastIsPlaying: boolean | null = null;
	private lastPlayMode: string | undefined = undefined;
	private lastModeBeforeShuffle: string | null = null;

	private lastVolume: number | null = null;
	private lastIsMuted: boolean | null = null;

	private readonly dispatchTimelineThrottled: () => void;

	private onPlayProgressCallback: ((info: { current: number }) => void) | null =
		null;

	constructor() {
		super();
		this.eventAdapter = new NcmEventAdapter();
		this.dispatchTimelineThrottled = throttle(() => {
			this.dispatchEvent(
				new CustomEvent<TimelineInfo>("timelineUpdate", {
					detail: {
						currentTime: this.musicPlayProgress,
						totalTime: this.musicDuration,
					},
				}),
			);
		}, CONSTANTS.TIMELINE_THROTTLE_INTERVAL_MS)[0];
	}

	public async initialize(): Promise<Result<void, NcmAdapterError>> {
		type AudioPlayerModule = { AudioPlayer: v3.AudioPlayer };

		try {
			const require = await getWebpackRequire();
			const audioPlayerModule = findModule(
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
				this.audioPlayer = audioPlayerModule.AudioPlayer;
			} else {
				logger.warn(
					"[V3 Provider] 找不到 AudioPlayer 模块。时间轴更新可能受到其它插件影响",
				);
			}
		} catch (error) {
			logger.error("[Adapter V3] 获取 Webpack require 失败:", error);
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
		logger.trace("[Adapter V3] 已订阅 Redux store 更新");

		this.registerAudioPlayerEvents();
		this.onStateChanged();

		return ok(undefined);
	}

	public dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.unregisterAudioPlayerEvents();

		logger.debug("[Adapter V3] Disposed.");
	}

	public getCurrentSongInfo(): Result<SongInfo, NcmAdapterError> {
		const playingInfo = this.reduxStore?.getState().playing;
		if (!playingInfo?.resourceTrackId) {
			return err(new SongNotFoundError("Redux state 中找不到 resourceTrackId"));
		}

		const albumName =
			playingInfo.curTrack?.album?.albumName ??
			playingInfo.curTrack?.album?.name ??
			playingInfo.resourceName ??
			"未知专辑";

		const currentTrackId = parseInt(String(playingInfo.resourceTrackId), 10);
		if (Number.isNaN(currentTrackId) || currentTrackId === 0) {
			return err(new SongNotFoundError("当前 trackId 无效"));
		}

		return ok({
			songName: playingInfo.resourceName || "未知歌名",
			authorName:
				playingInfo.resourceArtists?.map((v) => v.name).join(" / ") || "",
			albumName: albumName,
			thumbnailUrl: resizeImageUrl(playingInfo.resourceCoverUrl),
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

	public getPlayMode(): PlayModeInfo {
		const newNcmMode = this.reduxStore?.getState().playing?.playingMode;
		let isShuffling = false;
		let repeatMode: RepeatMode = "None";

		switch (newNcmMode) {
			case NCM_PLAY_MODES.SHUFFLE:
				isShuffling = true;
				repeatMode = "List";
				break;
			case NCM_PLAY_MODES.ORDER:
				isShuffling = false;
				repeatMode = "None";
				break;
			case NCM_PLAY_MODES.LOOP:
				isShuffling = false;
				repeatMode = "List";
				break;
			case NCM_PLAY_MODES.ONE_LOOP:
				isShuffling = false;
				repeatMode = "Track";
				break;
		}
		return { isShuffling, repeatMode };
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
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;
		if (!currentMode) return;

		const { targetMode, nextLastModeBeforeShuffle } = calculateNextShuffleMode(
			currentMode,
			this.lastModeBeforeShuffle,
			NCM_PLAY_MODES,
		);

		this.lastModeBeforeShuffle = nextLastModeBeforeShuffle;

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			payload: { playingMode: targetMode, triggerScene: "track" },
		});
	}

	public toggleRepeat(): void {
		if (!this.reduxStore) return;
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;
		if (!currentMode) return;

		const targetMode = calculateNextRepeatMode(currentMode, NCM_PLAY_MODES);

		// 切换循环模式就退出随机播放
		if (currentMode === NCM_PLAY_MODES.SHUFFLE) {
			this.lastModeBeforeShuffle = null;
		}

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			// 这里的 triggerScene 用来确保在所有模式切换中都能工作
			// 尤其是心动模式 (虽然我们当前不会切换到心动模式)
			payload: { playingMode: targetMode, triggerScene: "track" },
		});
	}

	public setRepeatMode(mode: RepeatMode): void {
		if (!this.reduxStore) return;

		let targetMode: string;
		switch (mode) {
			case "List":
				targetMode = NCM_PLAY_MODES.LOOP;
				break;
			case "Track":
				targetMode = NCM_PLAY_MODES.ONE_LOOP;
				break;
			case "AI":
				targetMode = NCM_PLAY_MODES.AI;
				break;
			default:
				targetMode = NCM_PLAY_MODES.ORDER;
				break;
		}

		// 设置循环模式就退出随机播放
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;
		if (currentMode === NCM_PLAY_MODES.SHUFFLE) {
			this.lastModeBeforeShuffle = null;
		}

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			payload: { playingMode: targetMode, triggerScene: "track" },
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
		const playingInfo = this.reduxStore.getState().playing;
		const songInfoResult = this.getCurrentSongInfo();
		if (
			songInfoResult.isOk() &&
			songInfoResult.value.ncmId !== this.lastTrackId
		) {
			this.lastTrackId = songInfoResult.value.ncmId;
			const playingInfo = this.reduxStore.getState().playing;
			if (playingInfo?.curTrack?.duration) {
				this.musicDuration = playingInfo.curTrack.duration;
			}
			this.dispatchEvent(
				new CustomEvent<SongInfo>("songChange", {
					detail: songInfoResult.value,
				}),
			);
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

		const playMode = this.reduxStore.getState().playing?.playingMode;
		if (playMode && playMode !== this.lastPlayMode) {
			this.lastPlayMode = playMode;
			this.dispatchEvent(
				new CustomEvent<PlayModeInfo>("playModeChange", {
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

	private registerAudioPlayerEvents(): void {
		this.eventAdapter.on("PlayState", this.onPlayStateChanged);
		if (this.audioPlayer) {
			this.onPlayProgressCallback = (info) => this.onPlayProgress(info.current);
			this.audioPlayer.subscribePlayStatus({
				type: "playprogress",
				callback: this.onPlayProgressCallback,
			});
		} else {
			this.eventAdapter.on("PlayProgress", this.onPlayProgressLegacy);
		}
	}

	private unregisterAudioPlayerEvents(): void {
		try {
			this.eventAdapter.off("PlayState", this.onPlayStateChanged);

			if (this.audioPlayer && this.onPlayProgressCallback) {
				this.audioPlayer.unSubscribePlayStatus(this.onPlayProgressCallback);
				this.onPlayProgressCallback = null;
			} else {
				this.eventAdapter.off("PlayProgress", this.onPlayProgressLegacy);
			}
		} catch (e) {
			logger.error("[Adapter V3] 清理原生事件监听时发生错误:", e);
		}
	}

	private onPlayProgress(progressInSeconds: number): void {
		this.musicPlayProgress = Math.floor(progressInSeconds * 1000);
		this.dispatchTimelineThrottled();
	}

	private readonly onPlayProgressLegacy = (
		_audioId: string,
		progress: number,
	): void => {
		this.onPlayProgress(progress);
	};

	private readonly onPlayStateChanged = (
		_audioId: string,
		stateInfo: string,
	): void => {
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
					logger.warn(`[Adapter V3] 未知的播放状态: ${stateKeyword}`);
					return;
			}
		} else {
			logger.warn(`[Adapter V3] 意外的播放状态: ${stateInfo}`);
			return;
		}

		if (this.playState !== newPlayState) {
			this.playState = newPlayState;
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: this.playState,
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
