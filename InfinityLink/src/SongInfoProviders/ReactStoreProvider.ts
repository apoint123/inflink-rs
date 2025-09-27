import type React from "react";
import type { PlaybackStatus } from "src/types/smtc";
import type {
	Artist,
	AudioLoadInfo,
	Channel,
	LegacyNativeCmder,
	NCMPlayMode,
	NCMStore,
	NcmEventMap,
	NcmEventName,
	ReactRootElement,
} from "../types/ncm-internal";
import { throttle } from "../utils";
import { BaseProvider } from "./BaseProvider";

/**
 * CSS 选择器常量
 */
const SELECTORS = {
	// 控制按钮
	PLAY_BUTTON: "#btn_pc_minibar_play:not(.play-pause-btn)",
	PAUSE_BUTTON: "#btn_pc_minibar_play.play-pause-btn",
	NEXT_BUTTON: 'button[data-log*="btn_pc_next"]',
	PREV_BUTTON: 'button[data-log*="btn_pc_prev"]',
	PLAY_MODE_BUTTON: 'div[data-log*="btn_pc_playmode"] button',

	// 状态指示器
	PLAY_MODE_ICON: "span[role='img']",

	// React 应用根节点
	REACT_ROOT: "#root",

	// 用于判断是否加载完成的元素
	PLAYER_BAR_READY:
		"footer > * > * > .middle > *:nth-child(1) > button:nth-child(4)",
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

declare const legacyNativeCmder: LegacyNativeCmder; // 主要用于 NCM 2.x, 但 3.0+ 也有在用
declare const channel: Channel; // 仅 NCM 3.0+

/**
 * 模拟 React 事件点击。
 * @param element 要点击的 HTML 元素。
 */
function triggerReactClick(element: HTMLElement | null): void {
	if (!element) return;

	const reactPropsKey = Object.keys(element).find((key) =>
		key.startsWith(CONSTANTS.REACT_PROPS_PREFIX),
	);

	if (reactPropsKey) {
		const props = (element as unknown as Record<string, unknown>)[
			reactPropsKey
		] as React.HTMLAttributes<HTMLElement> | undefined;

		if (props?.onClick) {
			props.onClick({} as React.MouseEvent<HTMLElement>);
			return;
		}
	}

	// 如果找不到 React 属性，则尝试原生点击
	element.click();
}

/**
 * 将图片 URL 转换为 Base64 字符串。
 * @param url 图片的 URL.
 * @returns Base64 格式的图片数据，如果失败则返回空字符串。
 */
async function imageUrlToBase64(url: string): Promise<string> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`获取图像失败: ${response.statusText}`);
		}
		const blob = await response.blob();
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const base64data = (reader.result as string).split(",")[1];
				resolve(base64data);
			};
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	} catch (error) {
		console.error(`[React Store Provider] 将 ${url} 转换为 base64 失败`, error);
		return "";
	}
}

function genRandomString(length: number): string {
	const words = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += words.charAt(Math.floor(Math.random() * words.length));
	}
	return result;
}

/**
 * DOM 控制器
 * 封装所有与 DOM 交互的操作。
 */
class DOMController {
	public play(): void {
		triggerReactClick(
			document.querySelector<HTMLButtonElement>(SELECTORS.PLAY_BUTTON),
		);
	}

	public pause(): void {
		triggerReactClick(
			document.querySelector<HTMLButtonElement>(SELECTORS.PAUSE_BUTTON),
		);
	}

	public nextSong(): void {
		triggerReactClick(
			document.querySelector<HTMLButtonElement>(SELECTORS.NEXT_BUTTON),
		);
	}

	public previousSong(): void {
		triggerReactClick(
			document.querySelector<HTMLButtonElement>(SELECTORS.PREV_BUTTON),
		);
	}

	public getCurrentPlayMode(): NCMPlayMode | null {
		const playModeButton = document.querySelector<HTMLButtonElement>(
			SELECTORS.PLAY_MODE_BUTTON,
		);
		const mode = playModeButton
			?.querySelector<HTMLSpanElement>(SELECTORS.PLAY_MODE_ICON)
			?.getAttribute("aria-label");
		return (mode as NCMPlayMode) || null;
	}
}

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
			console.error(`[React Store Provider] 注册事件 ${eventName}失败:`, e);
		}
	}
}

export class ReactStoreProvider extends BaseProvider {
	private audioId: string | null = null;
	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playState: PlaybackStatus = "Paused";
	private reduxStore: NCMStore | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private lastProgress = 0;
	private dispatchTimelineThrottled: () => void;
	private lastTrackId: string | null = null;
	private lastIsPlaying: boolean | null = null;
	private lastPlayMode: string | undefined = undefined;
	private lastModeBeforeShuffle: string | null = null;
	private isUpdatingFromProvider = false;

	private readonly domController: DOMController;
	private readonly eventAdapter: NcmEventAdapter;

	public ready: Promise<void>;
	private resolveReady!: () => void;

	public onPlayModeChange:
		| ((detail: { isShuffling: boolean; repeatMode: string }) => void)
		| null = null;

	constructor() {
		super();
		this.domController = new DOMController();
		this.eventAdapter = new NcmEventAdapter();

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
			console.error("[React Store Provider] 初始化失败:", e);
		});
	}

	private async initialize(): Promise<void> {
		// 等待 UI 加载完成
		await betterncm.utils.waitForElement(SELECTORS.PLAYER_BAR_READY);

		// 挂载 Redux Store 监听器
		const rootEl = document.getElementById(
			SELECTORS.REACT_ROOT.slice(1),
		) as ReactRootElement | null;
		const rootStore =
			rootEl?._reactRootContainer?._internalRoot?.current?.child?.child
				?.memoizedProps?.store;

		if (rootStore) {
			this.reduxStore = rootStore;
			this.unsubscribeStore = this.reduxStore.subscribe(() => {
				this.onStateChanged();
			});
		} else {
			console.error("[React Store Provider] UI已加载但无法找到Store!");
		}

		// 注册底层播放器事件和外部控制事件
		this.registerAudioPlayerEvents();
		this.registerControlListeners();

		// 初始化状态
		this.onStateChanged();

		this.resolveReady();
		console.log("[React Store Provider] 初始化完成");
	}

	private registerAudioPlayerEvents(): void {
		this.eventAdapter.on("Load", (audioId: string, info: AudioLoadInfo) =>
			this.onMusicLoad(audioId, info),
		);
		this.eventAdapter.on("End", (audioId: string) =>
			this.onMusicUnload(audioId),
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
		if (this.isUpdatingFromProvider) {
			return;
		}
		if (!this.reduxStore) {
			return;
		}

		const msg = e.detail;
		const currentMode = this.reduxStore.getState()?.playing?.playingMode;

		switch (msg.type) {
			case "Play":
				this.domController.play();
				if (this.playState !== "Playing") {
					this.playState = "Playing";
					this.dispatchEvent(
						new CustomEvent("updatePlayState", { detail: this.playState }),
					);
				}
				break;
			case "Pause":
				this.domController.pause();
				if (this.playState !== "Paused") {
					this.playState = "Paused";
					this.dispatchEvent(
						new CustomEvent("updatePlayState", { detail: this.playState }),
					);
				}
				break;
			case "NextSong":
				this.domController.nextSong();
				break;
			case "PreviousSong":
				this.domController.previousSong();
				break;
			case "Seek":
				if (typeof msg.position === "number") this.seekToPosition(msg.position);
				break;
			case "ToggleShuffle": {
				const isShuffleOn = currentMode === CONSTANTS.NCM_PLAY_MODE_SHUFFLE;
				const targetMode = isShuffleOn
					? this.lastModeBeforeShuffle || CONSTANTS.NCM_PLAY_MODE_LOOP
					: CONSTANTS.NCM_PLAY_MODE_SHUFFLE;

				if (!isShuffleOn && currentMode) {
					this.lastModeBeforeShuffle = currentMode;
				} else {
					this.lastModeBeforeShuffle = null;
				}

				this.reduxStore.dispatch({
					type: "playing/switchPlayingMode",
					payload: { playingMode: targetMode },
				});
				break;
			}
			case "ToggleRepeat": {
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

				this.reduxStore.dispatch({
					type: "playing/switchPlayingMode",
					payload: { playingMode: targetMode },
				});
				break;
			}
		}
	}

	private registerControlListeners(): void {
		this.addEventListener("control", this.handleControlEvent);
	}

	private async onStateChanged(forceDispatchPlayMode = false): Promise<void> {
		if (!this.reduxStore) return;

		const playingState = this.reduxStore.getState().playing;
		const newNcmMode = playingState?.playingMode;

		if (this.lastPlayMode !== newNcmMode || forceDispatchPlayMode) {
			this.lastPlayMode = newNcmMode || undefined;

			let isShuffling = newNcmMode === CONSTANTS.NCM_PLAY_MODE_SHUFFLE;
			let repeatMode = "None";

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

		const playingInfo = this.reduxStore.getState().playing;
		if (!playingInfo) return;
		// 处理歌曲信息变化
		const currentTrackId = String(playingInfo.resourceTrackId || "").trim();
		if (
			currentTrackId &&
			currentTrackId !== "0" &&
			currentTrackId !== this.lastTrackId
		) {
			this.lastTrackId = currentTrackId;
			if (playingInfo.curTrack?.duration) {
				this.musicDuration = playingInfo.curTrack.duration;
			}

			const thumbnailUrl = playingInfo.resourceCoverUrl || "";
			const thumbnailBase64 = thumbnailUrl
				? await imageUrlToBase64(thumbnailUrl)
				: "";

			this.dispatchEvent(
				new CustomEvent("updateSongInfo", {
					detail: {
						songName: playingInfo.resourceName || "未知歌名",
						authorName:
							playingInfo.resourceArtists
								?.map((v: Artist) => v.name)
								.join(" / ") || "",
						albumName: playingInfo.musicAlbumName ?? playingInfo.resourceName,
						thumbnail_base64: thumbnailBase64,
					},
				}),
			);
		}

		// 处理播放/暂停状态变化
		const isPlaying = !!playingInfo.playing;
		if (this.lastIsPlaying !== isPlaying) {
			this.lastIsPlaying = isPlaying;
			this.playState = isPlaying ? "Playing" : "Paused";
			this.dispatchEvent(
				new CustomEvent("updatePlayState", { detail: this.playState }),
			);
		}

		// 初始化播放进度
		if (playingInfo.progress !== undefined && this.musicPlayProgress === 0) {
			this.musicPlayProgress = Math.floor(playingInfo.progress * 1000);
			this.dispatchTimelineThrottled();
		}
	}

	private onMusicLoad(audioId: string, info: AudioLoadInfo): void {
		this.audioId = audioId;
		this.musicDuration = (info.duration * 1000) | 0;
	}

	private onMusicUnload(_audioId: string): void {
		if (this.playState !== "Paused") {
			this.playState = "Paused";
			this.dispatchEvent(
				new CustomEvent("updatePlayState", { detail: this.playState }),
			);
		}
	}

	private onPlayProgress(_audioId: string, progress: number): void {
		// 忽略因 seek 操作导致的进度大幅跳跃
		if (
			Math.abs(progress - this.lastProgress) >
				CONSTANTS.PROGRESS_JUMP_THRESHOLD_S &&
			progress > 0.01
		) {
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
		if (!this.audioId) {
			console.warn("[React Store Provider] audioID 不可用，跳转失败");
			return;
		}
		console.log(`[React Store Provider] 正在跳转到: ${timeMS / 1000}s`);

		this.musicPlayProgress = timeMS;
		this.dispatchEvent(
			new CustomEvent("updateTimeline", {
				detail: {
					currentTime: this.musicPlayProgress,
					totalTime: this.musicDuration,
				},
			}),
		);

		legacyNativeCmder._envAdapter.callAdapter("audioplayer.seek", () => {}, [
			this.audioId,
			`${this.audioId}|seek|${genRandomString(6)}`,
			timeMS / 1000,
		]);
	}

	public async forceDispatchFullState(): Promise<void> {
		if (!this.reduxStore?.getState().playing || !this.lastTrackId) {
			console.warn("[React Store Provider] 没有缓存的状态可以分发。");
			return;
		}
		const playingInfo = this.reduxStore.getState().playing;
		if (!playingInfo) return;

		const thumbnailUrl = playingInfo.resourceCoverUrl || "";
		const thumbnailBase64 = thumbnailUrl
			? await imageUrlToBase64(thumbnailUrl)
			: "";

		this.dispatchEvent(
			new CustomEvent("updateSongInfo", {
				detail: {
					songName: playingInfo.resourceName || "未知歌名",
					authorName:
						playingInfo.resourceArtists?.map((v) => v.name).join(" / ") || "",
					albumName: playingInfo.musicAlbumName ?? playingInfo.resourceName,
					thumbnail_base64: thumbnailBase64,
				},
			}),
		);

		this.dispatchEvent(
			new CustomEvent("updatePlayState", { detail: this.playState }),
		);

		this.dispatchEvent(
			new CustomEvent("updateTimeline", {
				detail: {
					currentTime: this.musicPlayProgress,
					totalTime: this.musicDuration,
				},
			}),
		);
		this.dispatchEvent(
			new CustomEvent("updatePlayMode", {
				detail: this.domController.getCurrentPlayMode(),
			}),
		);
	}

	public override dispose(): void {
		if (this.unsubscribeStore) {
			this.unsubscribeStore();
			this.unsubscribeStore = null;
		}
		this.removeEventListener("control", this.handleControlEvent);
		console.log("[React Store Provider] Disposed.");
	}
}
