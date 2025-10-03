import type { Artist } from "InfinityLink/src/types/ncm-internal";
import type { PlaybackStatus, RepeatMode } from "../../types/smtc";
import { throttle, waitForElement } from "../../utils";
import logger from "../../utils/logger";
import { BaseProvider } from "../provider";
import type { CtlDefPlayer, V2NCMStore } from "./types";

// 看起来很奇怪，但是网易云音乐内部确实是这样定义的
const NCM_PLAY_MODES = {
	LIST_LOOP: "playorder",
	SINGLE_LOOP: "playcycle",
	RANDOM: "playrandom",
	ORDER: "playonce",
	AI: "playai",
};

/**
 * 封装了对 v2 播放器实例的混淆 API 调用
 *
 * 这个类的实例代表一个播放器（defPlayer, fmPlayer等）
 *
 * 直接使用混淆后的函数名很脆弱，但考虑到网易云 v2 都不更新了，
 * 直接使用问题也不大
 */
class NcmV2PlayerApi {
	private readonly playerInstance: CtlDefPlayer;

	constructor(playerInstance: CtlDefPlayer) {
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

	public switchMode(mode: string): void {
		this.playerInstance.KJ(`mode_${mode}`);
	}

	public getProgress(): number {
		return this.playerInstance.Gn();
	}

	public getDuration(): number {
		return this.playerInstance.tQ;
	}
}

interface FiberNode {
	memoizedProps?: {
		store?: V2NCMStore;
	};
	return: FiberNode | null;
}

// 网易云v2的store路径包含每次启动都变化的哈希，所以得每次都寻找它
async function findReduxStore(selector: string): Promise<V2NCMStore> {
	const rootEl = await waitForElement(selector);
	if (!rootEl) {
		throw new Error(`根元素 ('${selector}') 未找到`);
	}

	const findStoreInFiberTree = (node: FiberNode | null): V2NCMStore | null => {
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

class V2Provider extends BaseProvider {
	private musicDuration = 0;
	private musicPlayProgress = 0;

	private reduxStore: V2NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;

	private lastReduxTrackId: unknown = null;
	private lastPlayMode: string | undefined = undefined;
	private _lastDispatchedTrackId: string | null = null;

	private lastModeBeforeShuffle: string | null = null;

	private readonly dispatchTimelineThrottled: () => void;

	/**
	 * 获取当前播放器（defPlayer, fmPlayer 等）的实例
	 */
	private get activePlayerApi(): NcmV2PlayerApi | null {
		const currentPlayerInstance = ctl.player?.Hn();
		if (currentPlayerInstance) {
			return new NcmV2PlayerApi(currentPlayerInstance);
		}
		return null;
	}

	constructor() {
		super();
		this.ready = this.initialize();

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
		}, 1000)[0];
	}

	private async initialize(): Promise<void> {
		try {
			this.reduxStore = await findReduxStore("#portal_root");
			this.unsubscribeStore = this.reduxStore.subscribe(() =>
				this.onStateChanged(),
			);
		} catch (error) {
			logger.error("[V2 Provider] 初始化 Redux store 失败:", error);
		}

		this.registerNcmEvents();
		this.addEventListener("control", this.handleControlEvent);

		this.onStateChanged();
	}

	private registerNcmEvents(): void {
		legacyNativeCmder.appendRegisterCall(
			"PlayState",
			"audioplayer",
			(_audioId: string, state: string | number) =>
				this.onPlayStateChanged(state),
		);
		legacyNativeCmder.appendRegisterCall(
			"PlayProgress",
			"audioplayer",
			(_audioId: string, progress: number) => this.onPlayProgress(progress),
		);
	}

	private onPlayStateChanged(stateInfo: string | number): void {
		let newPlayState: PlaybackStatus = "Paused";
		if (typeof stateInfo === "string") {
			const state = stateInfo.split("|")[1];
			if (state === "resume" || state === "play") newPlayState = "Playing";
		}
		this.dispatchEvent(
			new CustomEvent("updatePlayState", { detail: newPlayState }),
		);
	}

	private onPlayProgress(progressInSeconds: number): void {
		this.musicPlayProgress = Math.floor(progressInSeconds * 1000);
		this.dispatchTimelineThrottled();
	}

	private onStateChanged(): void {
		if (!this.reduxStore) return;
		const playingState = this.reduxStore.getState().playing;
		if (!playingState) return;

		const newTrackId = playingState.resourceTrackId;
		if (newTrackId && newTrackId !== this.lastReduxTrackId) {
			this.lastReduxTrackId = newTrackId;
			this.dispatchSongInfoUpdate(true);
		}

		const newPlayMode = playingState.playMode;
		if (newPlayMode && newPlayMode !== this.lastPlayMode) {
			this.dispatchPlayModeUpdate();
		}
	}

	private handleControlEvent(e: CustomEvent): void {
		const msg = e.detail;
		logger.info(`[V2 Provider] 处理后端控制事件: ${msg.type}`, msg);

		switch (msg.type) {
			case "Play":
				this.activePlayerApi?.resume();
				break;
			case "Pause":
				this.activePlayerApi?.pause();
				this.dispatchEvent(
					new CustomEvent("updatePlayState", { detail: "Paused" }),
				);
				break;
			case "NextSong":
				this.activePlayerApi?.next();
				break;
			case "PreviousSong":
				this.activePlayerApi?.previous();
				break;
			case "Seek":
				if (typeof msg.position === "number" && this.musicDuration > 0) {
					const targetTimeMs = msg.position;
					const progressRatio = targetTimeMs / this.musicDuration;

					this.musicPlayProgress = targetTimeMs;
					this.dispatchEvent(
						new CustomEvent("updateTimeline", {
							detail: {
								currentTime: this.musicPlayProgress,
								totalTime: this.musicDuration,
							},
						}),
					);

					this.activePlayerApi?.seek(progressRatio);
				}
				break;
			case "ToggleShuffle": {
				if (!this.reduxStore) return;
				const currentMode = this.reduxStore.getState()?.playing?.playMode;
				const isShuffleOn = currentMode === NCM_PLAY_MODES.RANDOM;
				const targetMode = isShuffleOn
					? this.lastModeBeforeShuffle || NCM_PLAY_MODES.SINGLE_LOOP
					: NCM_PLAY_MODES.RANDOM;

				if (!isShuffleOn && currentMode) {
					this.lastModeBeforeShuffle = currentMode;
				} else {
					this.lastModeBeforeShuffle = null;
				}
				this.activePlayerApi?.switchMode(targetMode);
				break;
			}
			case "ToggleRepeat": {
				if (!this.reduxStore) return;
				const currentMode = this.reduxStore.getState()?.playing?.playMode;
				let targetMode: string;

				if (currentMode === NCM_PLAY_MODES.RANDOM) {
					targetMode = NCM_PLAY_MODES.LIST_LOOP;
					this.lastModeBeforeShuffle = null;
				} else {
					switch (currentMode) {
						case NCM_PLAY_MODES.LIST_LOOP:
							targetMode = NCM_PLAY_MODES.SINGLE_LOOP;
							break;
						case NCM_PLAY_MODES.SINGLE_LOOP:
							targetMode = NCM_PLAY_MODES.ORDER;
							break;
						default:
							targetMode = NCM_PLAY_MODES.LIST_LOOP;
							break;
					}
				}
				this.activePlayerApi?.switchMode(targetMode);
				break;
			}
		}
	}

	private dispatchSongInfoUpdate(force = false): void {
		const song = betterncm.ncm.getPlayingSong();
		if (!song?.data) return;
		const currentTrackId = String(song.data.id).trim();
		if (force || currentTrackId !== this._lastDispatchedTrackId) {
			this._lastDispatchedTrackId = currentTrackId;

			const newDuration = song.data.duration || 0;
			if (newDuration > 0) {
				this.musicDuration = newDuration;
			}

			this.dispatchEvent(
				new CustomEvent("updateSongInfo", {
					detail: {
						songName: song.data.name || "未知歌名",
						authorName:
							song.data.artists?.map((v: Artist) => v.name).join(" / ") || "",
						albumName: song.data.album?.name || "未知专辑",
						thumbnailUrl: song.data.album?.picUrl || "",
						ncmId: currentTrackId,
					},
				}),
			);

			this.dispatchEvent(
				new CustomEvent("updateTimeline", {
					detail: {
						currentTime: 0,
						totalTime: this.musicDuration,
					},
				}),
			);
		}
	}

	private dispatchPlayModeUpdate(): void {
		const newNcmMode = this.reduxStore?.getState().playing?.playMode;
		if (this.lastPlayMode !== newNcmMode) {
			this.lastPlayMode = newNcmMode;
			let isShuffling = newNcmMode === NCM_PLAY_MODES.RANDOM;
			let repeatMode: RepeatMode = "None";
			switch (newNcmMode) {
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

			this.dispatchEvent(
				new CustomEvent("updatePlayMode", {
					detail: { isShuffling, repeatMode },
				}),
			);
		}
	}

	public override forceDispatchFullState(): void {
		this.onStateChanged();
		const playerApi = this.activePlayerApi;
		if (!playerApi) return;

		const progress = playerApi.getProgress();
		const duration = playerApi.getDuration();
		if (duration > 0) {
			this.musicDuration = Math.floor(duration * 1000);
			this.onPlayProgress(progress);
		}
	}

	public override dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.removeEventListener("control", this.handleControlEvent);
		logger.debug("[V2 Provider] Disposed.");
		super.dispose();
	}
}

export default V2Provider;
