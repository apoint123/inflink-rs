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
	findModule,
	getWebpackRequire,
	resizeImageUrl,
	throttle,
	waitForElement,
} from "../../utils";
import { NcmEventAdapter, type ParsedEventMap } from "../../utils/event";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap, PlayModeInfo } from "../adapter";
import { PlayModeController } from "../playModeController";

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

	private lastVolume: number | null = null;
	private lastIsMuted: boolean | null = null;

	private readonly dispatchTimelineThrottled: () => void;
	private readonly resetTimelineThrottle: () => void;

	private readonly playModeController = new PlayModeController(NCM_PLAY_MODES);

	private onPlayProgressCallback: ((info: v3.PlayProgressInfo) => void) | null =
		null;
	private onSeekCallback: ((info: v3.SeekInfo) => void) | null = null;

	constructor() {
		super();
		this.eventAdapter = new NcmEventAdapter("v3");
		[this.dispatchTimelineThrottled, , this.resetTimelineThrottle] = throttle(
			() => this._dispatchTimelineUpdateNow(),
			CONSTANTS.TIMELINE_THROTTLE_INTERVAL_MS,
		);
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
		this.eventAdapter.dispose();

		logger.debug("[Adapter V3] Disposed.");
	}

	public getCurrentSongInfo(): Result<SongInfo, NcmAdapterError> {
		const state = this.reduxStore?.getState();
		const playingInfo = state?.playing;

		if (playingInfo?.resourceType === "voice") {
			const vinylInfo = state?.["page:vinylPage"];
			const currentVoice = vinylInfo?.currentVoice;

			if (!currentVoice?.id) {
				return err(
					new SongNotFoundError(
						"正在播放播客，但在 page:vinylPage 中找不到 currentVoice",
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
				thumbnailUrl: resizeImageUrl(currentVoice.coverUrl),
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

		const currentTrackId = parseInt(String(playingInfo.resourceTrackId), 10);
		if (Number.isNaN(currentTrackId) || currentTrackId === 0) {
			return err(new SongNotFoundError("当前 trackId 无效"));
		}

		return ok({
			songName: playingInfo.resourceName || "未知歌名",
			authorName:
				playingInfo.resourceArtists?.map((v) => v.name).join(" / ") ||
				"未知艺术家",
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
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;
		if (!currentMode) return;

		const targetMode = this.playModeController.getNextShuffleMode(currentMode);

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			payload: { playingMode: targetMode, triggerScene: "track" },
		});
	}

	public toggleRepeat(): void {
		if (!this.reduxStore) return;
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;
		if (!currentMode) return;

		const targetMode = this.playModeController.getNextRepeatMode(currentMode);

		this.reduxStore.dispatch({
			type: "playing/switchPlayingMode",
			// 这里的 triggerScene 用来确保在所有模式切换中都能工作
			// 尤其是心动模式 (虽然我们当前不会切换到心动模式)
			payload: { playingMode: targetMode, triggerScene: "track" },
		});
	}

	public setRepeatMode(mode: RepeatMode): void {
		if (!this.reduxStore) return;
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;
		if (!currentMode) return;

		const targetMode = this.playModeController.getRepeatMode(mode, currentMode);

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
		const state = this.reduxStore.getState();
		const playingInfo = state.playing;
		const songInfoResult = this.getCurrentSongInfo();

		if (
			songInfoResult.isOk() &&
			songInfoResult.value.ncmId !== this.lastTrackId
		) {
			this.lastTrackId = songInfoResult.value.ncmId;

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

		const playMode = playingInfo?.playingMode;
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
		this.eventAdapter.addEventListener(
			"playStateChange",
			this.onPlayStateChanged,
		);

		if (this.audioPlayer) {
			this.onPlayProgressCallback = (info) => {
				if ("current" in info) {
					this.musicPlayProgress = info.current * 1000;
					this.dispatchTimelineThrottled();
				}
			};
			this.audioPlayer.subscribePlayStatus({
				type: "playprogress",
				callback: this.onPlayProgressCallback,
			});

			this.onSeekCallback = (info) => {
				if ("position" in info) {
					const positionInMs = Math.floor(info.position * 1000);
					this.onSeekUpdate({
						detail: positionInMs,
					} as CustomEvent<number>);
				}
			};
			this.audioPlayer.subscribePlayStatus({
				type: "seek",
				callback: this.onSeekCallback,
			});
		} else {
			this.eventAdapter.addEventListener(
				"progressUpdate",
				this.onProgressUpdate,
			);
		}
	}

	private unregisterAudioPlayerEvents(): void {
		try {
			this.eventAdapter.removeEventListener(
				"playStateChange",
				this.onPlayStateChanged,
			);

			if (this.audioPlayer) {
				if (this.onPlayProgressCallback) {
					this.audioPlayer.unSubscribePlayStatus(this.onPlayProgressCallback);
					this.onPlayProgressCallback = null;
				}
				// 反注册 Seek 事件似乎是无效的，因为 unSubscribePlayStatus
				// 实际上只会尝试从 PlayState 事件上移除监听器
				// 猜测这可能和 PlayProgress 和 seek 等事件的怪癖有关
				if (this.onSeekCallback) {
					this.audioPlayer.unSubscribePlayStatus(this.onSeekCallback);
					this.onSeekCallback = null;
				}
			} else {
				this.eventAdapter.removeEventListener(
					"progressUpdate",
					this.onProgressUpdate,
				);
			}
		} catch (e) {
			logger.error("[Adapter V3] 清理原生事件监听时发生错误:", e);
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
