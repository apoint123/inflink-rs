import type {
	AudioLoadInfo,
	Channel,
	ClickableReactProps,
	LegacyNativeCmder,
	NCMPlayMode,
	NCMReduxState,
	NcmEventMap,
	NcmEventName,
	ReactRootElement,
} from "../types";
import { throttle } from "../utils";
import { BaseProvider, type PlayState } from "./BaseProvider";

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
	// setPlayMode 函数的相关配置
	SET_PLAY_MODE_POLL_INTERVAL_MS: 50, // 切换播放模式后的轮询等待时间
	SET_PLAY_MODE_MAX_ATTEMPTS: 5, // 最大尝试切换次数

	// 时间线更新节流间隔
	TIMELINE_THROTTLE_INTERVAL_MS: 1000,

	PROGRESS_JUMP_THRESHOLD_S: 1.5,

	// React 内部 props 属性的前缀
	REACT_PROPS_PREFIX: "__reactProps$",
};

declare const legacyNativeCmder: LegacyNativeCmder; // NCM 2.x
declare const channel: Channel; // NCM 3.0+

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
		] as ClickableReactProps | undefined;

		if (props?.onClick) {
			props.onClick();
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

	public togglePlayMode(): void {
		triggerReactClick(
			document.querySelector<HTMLButtonElement>(SELECTORS.PLAY_MODE_BUTTON),
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
	private readonly isNCMV3: boolean;
	private registeredEvt?: Set<string>;
	private callbacks?: Map<string, Set<NcmEventMap[NcmEventName]>>;

	constructor() {
		this.isNCMV3 = this.checkIsNCMV3();
		if (this.isNCMV3) {
			this.registeredEvt = new Set<string>();
			this.callbacks = new Map<string, Set<NcmEventMap[NcmEventName]>>();
		}
	}

	private checkIsNCMV3(): boolean {
		try {
			const version =
				window.APP_CONF?.appver || betterncm?.ncm?.getNCMVersion();

			if (version) {
				return parseInt(version.split(".")[0], 10) >= 3;
			}
		} catch {}
		return false;
	}

	public on<E extends NcmEventName>(
		eventName: E,
		callback: NcmEventMap[E],
	): void {
		const namespace = "audioplayer";
		try {
			if (this.isNCMV3) {
				if (!this.registeredEvt || !this.callbacks) {
					console.error(
						"[React Store Provider] NCMv3 event handler not initialized correctly.",
					);
					return;
				}

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
			} else if (legacyNativeCmder?.appendRegisterCall) {
				legacyNativeCmder.appendRegisterCall(
					eventName,
					namespace,
					callback as (...args: unknown[]) => void,
				);
			}
		} catch (e) {
			console.error(
				`[React Store Provider] Failed to register event ${eventName} for NCM v${
					this.isNCMV3 ? "3" : "2"
				}`,
				e,
			);
		}
	}
}

export class ReactStoreProvider extends BaseProvider {
	private audioId: string | null = null;
	private musicDuration = 0;
	private musicPlayProgress = 0;
	private playState: PlayState = "Paused";
	private store: NCMReduxState | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private lastProgress = 0;
	private dispatchTimelineThrottled: () => void;
	private lastTrackId: string | null = null;
	private lastIsPlaying: boolean | null = null;
	private lastPlayMode: string | undefined = undefined;
	private isSwitchingMode = false;

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
			this.store = rootStore.getState();
			this.unsubscribeStore = rootStore.subscribe(() => {
				this.store = rootStore.getState();
				this.onStateChanged();
			});
		} else {
			console.error("[React Store Provider] UI已加载但无法找到Store！");
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

	private registerControlListeners(): void {
		this.addEventListener("control", async (e: CustomEvent) => {
			const msg = e.detail;
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
					if (typeof msg.position === "number")
						this.seekToPosition(msg.position);
					break;
				case "ToggleShuffle": {
					if (this.isSwitchingMode) return;
					const isShuffle =
						this.domController.getCurrentPlayMode() === "shuffle";
					await this.setPlayMode(isShuffle ? "loop" : "shuffle");
					break;
				}
				case "ToggleRepeat": {
					if (this.isSwitchingMode) return;
					const currentMode = this.domController.getCurrentPlayMode();
					let targetMode: NCMPlayMode = "loop";
					if (currentMode === "order") targetMode = "loop";
					else if (currentMode === "loop") targetMode = "singleloop";
					else targetMode = "order";
					await this.setPlayMode(targetMode);
					break;
				}
			}
		});
	}

	private async setPlayMode(targetMode: NCMPlayMode): Promise<void> {
		console.log(`[React Store Provider] Setting play mode to: ${targetMode}`);
		this.isSwitchingMode = true;

		for (let i = 0; i < CONSTANTS.SET_PLAY_MODE_MAX_ATTEMPTS; i++) {
			const currentMode = this.domController.getCurrentPlayMode();
			if (currentMode === targetMode) {
				break;
			}
			this.domController.togglePlayMode();
			// 等待 UI 响应
			await new Promise((resolve) =>
				setTimeout(resolve, CONSTANTS.SET_PLAY_MODE_POLL_INTERVAL_MS),
			);
		}

		this.isSwitchingMode = false;
		// 强制分发一次播放模式更新事件
		this.onStateChanged(true);
	}

	private async onStateChanged(forceDispatchPlayMode = false): Promise<void> {
		if (!this.store?.playing) return;
		const playingInfo = this.store.playing;

		// 处理播放模式变化
		const currentNcmMode = this.domController.getCurrentPlayMode();
		if (this.lastPlayMode !== currentNcmMode || forceDispatchPlayMode) {
			this.lastPlayMode = currentNcmMode || undefined;

			if (!this.isSwitchingMode || forceDispatchPlayMode) {
				let isShuffling = false;
				let repeatMode = "None"; // "None", "List", "Track"
				switch (currentNcmMode) {
					case "shuffle":
						isShuffling = true;
						repeatMode = "List";
						break;
					case "order":
						isShuffling = false;
						repeatMode = "None";
						break;
					case "loop":
						isShuffling = false;
						repeatMode = "List";
						break;
					case "singleloop":
						isShuffling = false;
						repeatMode = "Track";
						break;
				}
				this.onPlayModeChange?.({ isShuffling, repeatMode });
				this.dispatchEvent(
					new CustomEvent("updatePlayMode", { detail: currentNcmMode }),
				);
			}
		}

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
							playingInfo.resourceArtists?.map((v) => v.name).join(" / ") || "",
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
		let newPlayState: PlayState = this.playState;
		if (typeof stateInfo === "string") {
			// NCM 3.0+
			const state = stateInfo.split("|")[1];
			if (state === "pause") newPlayState = "Paused";
			else if (state === "resume") newPlayState = "Playing";
		} else if (typeof stateInfo === "number") {
			// NCM 2.x
			newPlayState = stateInfo === 1 ? "Playing" : "Paused";
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
			console.warn("[Provider] audioID 不可用，跳转失败");
			return;
		}
		console.log(`[Provider] 正在跳转到: ${timeMS / 1000}s`);

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
		if (!this.store?.playing || !this.lastTrackId) {
			console.warn("[React Store Provider] 没有缓存的状态可以分发。");
			return;
		}
		const playingInfo = this.store.playing;

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
		console.log("[React Store Provider] Disposed.");
	}
}
