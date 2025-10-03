import type {
	Artist,
	AudioLoadInfo,
} from "InfinityLink/src/types/ncm-internal";
import type { PlaybackStatus, RepeatMode } from "../../types/smtc";
import { throttle, waitForElement } from "../../utils";
import logger from "../../utils/logger";
import { BaseProvider } from "../provider";
import type { V2NCMStore } from "./types";

const NCM_PLAY_MODES = {
	ORDER: "playorder",
	LOOP: "playcycle",
	RANDOM: "playrandom",
	ONE: "playonce",
	AI: "playai",
};

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

	// 目前观察到有 fmPlayer 用来私人漫游，mvPlayer 用来播放 MV，
	// 这里目前只使用 defPlayer 实例，之后可能需要扩展
	private readonly playerActions = {
		// 直接使用混淆后的函数名很脆弱，但考虑到网易云 v2 都不更新了，
		// 直接使用问题也不大
		resume: () => ctl.defPlayer.KJ("play"),
		pause: () => ctl.defPlayer.KJ("pause"),
		next: () => ctl.defPlayer.KJ("playnext"),
		prev: () => ctl.defPlayer.KJ("playprev"),
		seek: (progressRatio: number) => ctl.defPlayer.Qn(progressRatio),
		switchMode: (mode: string) => ctl.defPlayer.KJ(`mode_${mode}`),
	};

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
			"Load",
			"audioplayer",
			(_audioId: string, info: AudioLoadInfo) => this.onMusicLoad(info),
		);
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

	private onMusicLoad(info: AudioLoadInfo): void {
		this.musicDuration = (info.duration * 1000) | 0;
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
		this.dispatchPlayModeUpdate();
	}

	private handleControlEvent(e: CustomEvent): void {
		const msg = e.detail;
		logger.info(`[V2 Provider] 处理后端控制事件: ${msg.type}`, msg);

		switch (msg.type) {
			case "Play":
				this.playerActions.resume();
				break;
			case "Pause":
				this.playerActions.pause();
				this.dispatchEvent(
					new CustomEvent("updatePlayState", { detail: "Paused" }),
				);
				break;
			case "NextSong":
				this.playerActions.next();
				break;
			case "PreviousSong":
				this.playerActions.prev();
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

					this.playerActions.seek(progressRatio);
				}
				break;
			case "ToggleShuffle": {
				if (!this.reduxStore) return;
				const currentMode = this.reduxStore.getState()?.playing?.playMode;
				const isShuffleOn = currentMode === NCM_PLAY_MODES.RANDOM;
				const targetMode = isShuffleOn
					? this.lastModeBeforeShuffle || NCM_PLAY_MODES.LOOP
					: NCM_PLAY_MODES.RANDOM;

				if (!isShuffleOn && currentMode) {
					this.lastModeBeforeShuffle = currentMode;
				} else {
					this.lastModeBeforeShuffle = null;
				}
				this.playerActions.switchMode(targetMode);
				break;
			}
			case "ToggleRepeat": {
				if (!this.reduxStore) return;
				const currentMode = this.reduxStore.getState()?.playing?.playMode;
				let targetMode: string;

				if (currentMode === NCM_PLAY_MODES.RANDOM) {
					targetMode = NCM_PLAY_MODES.ORDER;
					this.lastModeBeforeShuffle = null;
				} else {
					switch (currentMode) {
						case NCM_PLAY_MODES.ORDER:
							targetMode = NCM_PLAY_MODES.LOOP;
							break;
						case NCM_PLAY_MODES.LOOP:
							targetMode = NCM_PLAY_MODES.ONE;
							break;
						default:
							targetMode = NCM_PLAY_MODES.ORDER;
							break;
					}
				}
				this.playerActions.switchMode(targetMode);
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
			this.dispatchEvent(
				new CustomEvent("updateSongInfo", {
					detail: {
						songName: song.data.name || "未知歌名",
						authorName:
							song.data.artists?.map((v: Artist) => v.name).join(" / ") || "",
						albumName: song.data.album?.name || "未知专辑",
						thumbnailUrl: song.data.album?.picUrl || "",
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
				case NCM_PLAY_MODES.ORDER:
					isShuffling = false;
					repeatMode = "List";
					break;
				case NCM_PLAY_MODES.LOOP:
					isShuffling = false;
					repeatMode = "Track";
					break;
				case NCM_PLAY_MODES.ONE:
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
		const progress = ctl.defPlayer.sL?.currentTime || 0;
		const duration = ctl.defPlayer.sL?.duration || 0;
		if (duration > 0) {
			this.musicDuration = duration * 1000;
			this.onPlayProgress(progress / duration);
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
