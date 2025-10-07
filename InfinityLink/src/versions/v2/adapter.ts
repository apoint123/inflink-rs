import type { v2 } from "../../types/ncm";
import type {
	PlaybackStatus,
	RepeatMode,
	SongInfo,
	TimelineInfo,
} from "../../types/smtc";
import {
	calculateNextRepeatMode,
	calculateNextShuffleMode,
	throttle,
	waitForElement,
} from "../../utils";
import logger from "../../utils/logger";
import type { INcmAdapter, NcmAdapterEventMap, PlayModeInfo } from "../adapter";

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
 * 如果某天网易云真的又给 v2 更新了一个版本，这里几乎肯定会出错
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
}

interface FiberNode {
	memoizedProps?: {
		store?: v2.NCMStore;
	};
	return: FiberNode | null;
}

// 网易云v2的store路径包含每次启动都变化的哈希，所以得每次都寻找它
async function findReduxStore(selector: string): Promise<v2.NCMStore> {
	const rootEl = await waitForElement(selector);
	if (!rootEl) {
		throw new Error(`根元素 ('${selector}') 未找到`);
	}

	const findStoreInFiberTree = (node: FiberNode | null): v2.NCMStore | null => {
		let currentNode = node;
		while (currentNode) {
			if (currentNode.memoizedProps?.store) {
				return currentNode.memoizedProps.store;
			}
			currentNode = currentNode.return;
		}
		return null;
	};

	const appEl = rootEl.firstElementChild as HTMLElement;
	if (!appEl) {
		throw new Error("根元素没有子元素");
	}

	const fiberKey = Object.keys(appEl).find(
		(key) =>
			key.startsWith("__reactFiber$") ||
			key.startsWith("__reactInternalInstance$"),
	);
	if (!fiberKey) {
		throw new Error("找不到 Fiber key");
	}

	const startNode = (appEl as unknown as Record<string, FiberNode>)[fiberKey];
	if (!startNode) {
		throw new Error("找不到起始 Fiber 节点");
	}

	const store = findStoreInFiberTree(startNode);
	if (!store) {
		throw new Error("找不到 redux store");
	}

	return store;
}

export class V2NcmAdapter extends EventTarget implements INcmAdapter {
	private reduxStore: v2.NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;

	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playStatus: PlaybackStatus = "Paused";
	private lastReduxTrackId: number | null = null;
	private lastPlayMode: NcmPlayMode | undefined = undefined;
	private lastModeBeforeShuffle: NcmPlayMode | null = null;

	private readonly dispatchTimelineThrottled: () => void;

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

	public async initialize(): Promise<void> {
		try {
			this.reduxStore = await findReduxStore("#portal_root");

			if (import.meta.env.MODE === "development") {
				window.infstore = this.reduxStore;
			}

			this.unsubscribeStore = this.reduxStore.subscribe(() =>
				this.onStateChanged(),
			);
		} catch (error) {
			logger.error("[Adapter V2] 初始化 Redux store 失败:", error);
		}

		this.registerNcmEvents();
		this.onStateChanged();
	}

	public dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		logger.debug("[Adapter V2] Disposed.");
	}

	public getCurrentSongInfo(): SongInfo | null {
		let songData: v2.SongData | null = null;
		const playerApi = this.activePlayerApi;

		if (playerApi) {
			songData = playerApi.currentSongData;
			// FM 模式
			if (!songData) {
				songData = playerApi.getFmSongData();
			}
		}

		if (!songData?.id) return null;

		return {
			songName: songData.name || "未知歌名",
			authorName: songData.artists?.map((v) => v.name).join(" / ") || "",
			albumName: songData.album?.name || "未知专辑",
			thumbnailUrl: songData.album?.picUrl || "",
			ncmId: songData.id,
		};
	}

	public getPlaybackStatus(): PlaybackStatus {
		if (this.activePlayerApi) {
			return this.activePlayerApi.isPlaying() ? "Playing" : "Paused";
		}
		return this.playStatus;
	}

	public getTimelineInfo(): TimelineInfo | null {
		if (this.musicDuration > 0) {
			return {
				currentTime: this.musicPlayProgress,
				totalTime: this.musicDuration,
			};
		}
		return null;
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
		if (!this.reduxStore) return;
		const currentMode = this.reduxStore.getState()?.playing?.playMode;
		if (!isValidNcmPlayMode(currentMode) || !currentMode) return;

		const { targetMode, nextLastModeBeforeShuffle } = calculateNextShuffleMode(
			currentMode,
			this.lastModeBeforeShuffle,
			V2_MODE_CONSTANTS,
		);

		this.lastModeBeforeShuffle =
			nextLastModeBeforeShuffle as NcmPlayMode | null;
		this.activePlayerApi?.switchMode(targetMode as NcmPlayMode);
	}

	public toggleRepeat(): void {
		if (!this.reduxStore) return;
		const currentMode = this.reduxStore.getState()?.playing?.playMode;
		if (!isValidNcmPlayMode(currentMode) || !currentMode) return;

		const targetMode = calculateNextRepeatMode(currentMode, V2_MODE_CONSTANTS);

		// 切换循环模式就退出随机播放
		if (currentMode === V2_MODE_CONSTANTS.SHUFFLE) {
			this.lastModeBeforeShuffle = null;
		}

		this.activePlayerApi?.switchMode(targetMode as NcmPlayMode);
	}

	public setRepeatMode(mode: RepeatMode): void {
		let targetMode: string;
		switch (mode) {
			case "List":
				targetMode = V2_MODE_CONSTANTS.LOOP;
				break;
			case "Track":
				targetMode = V2_MODE_CONSTANTS.ONE_LOOP;
				break;
			case "AI":
				targetMode = V2_MODE_CONSTANTS.AI;
				break;
			default:
				targetMode = V2_MODE_CONSTANTS.ORDER;
				break;
		}

		// 设置循环模式就退出随机播放
		const currentMode = this.reduxStore?.getState()?.playing?.playMode;
		if (currentMode === V2_MODE_CONSTANTS.SHUFFLE) {
			this.lastModeBeforeShuffle = null;
		}

		this.activePlayerApi?.switchMode(targetMode as NcmPlayMode);
	}

	private onStateChanged(): void {
		if (!this.reduxStore) return;
		const playingState = this.reduxStore.getState()?.playing;
		if (!playingState) return;

		const newTrackId = playingState.resourceTrackId;
		if (newTrackId && newTrackId !== this.lastReduxTrackId) {
			this.lastReduxTrackId = newTrackId;

			const songInfo = this.getCurrentSongInfo();
			if (songInfo) {
				this.dispatchEvent(
					new CustomEvent<SongInfo>("songChange", { detail: songInfo }),
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
	}

	private onPlayProgress(progressInSeconds: number): void {
		this.musicPlayProgress = Math.floor(progressInSeconds * 1000);
		const newDuration = this.activePlayerApi?.getDuration() ?? 0;
		if (newDuration > 0) {
			this.musicDuration = Math.floor(newDuration * 1000);
		}
		this.dispatchTimelineThrottled();
	}

	private onPlayStateChanged(stateInfo: string): void {
		const parts = stateInfo.split("|");
		let newPlayState: PlaybackStatus = this.playStatus;

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

		if (this.playStatus !== newPlayState) {
			this.playStatus = newPlayState;
			this.dispatchEvent(
				new CustomEvent<PlaybackStatus>("playStateChange", {
					detail: this.playStatus,
				}),
			);
		}
	}

	public override dispatchEvent<K extends keyof NcmAdapterEventMap>(
		event: NcmAdapterEventMap[K],
	): boolean {
		return super.dispatchEvent(event);
	}
}
