import type { PlaybackStatus } from "../types/backend";
import type { OrpheusCommand } from "../types/global";
import type { EventMap, EventName } from "../types/ncm";
import logger from "./logger";

export interface ParsedEventMap {
	playStateChange: CustomEvent<PlaybackStatus>;
	progressUpdate: CustomEvent<number>;
	seekUpdate: CustomEvent<number>;
}

const NcmPlayState = {
	NULL: 0,
	PLAYING: 1,
	PAUSED: 2,
	ERROR: 3,
	END: 4,
} as const;

export class NcmEventAdapter {
	private readonly dispatcher = new EventTarget();
	private readonly nativeCmder: OrpheusCommand;

	private readonly registeredLegacyEvents = new Map<
		string,
		Set<(...args: unknown[]) => void>
	>();
	private readonly legacyCallbacks = new Map<
		string,
		Set<EventMap[EventName]>
	>();

	constructor(cmder?: OrpheusCommand) {
		this.nativeCmder = cmder || window.legacyNativeCmder;
		this._registerNativeEvents();
	}

	public dispose(): void {
		this.unregisterNativeEvents();
	}

	public addEventListener<K extends keyof ParsedEventMap>(
		type: K,
		listener: (this: NcmEventAdapter, ev: ParsedEventMap[K]) => unknown,
	): void {
		this.dispatcher.addEventListener(type, listener as EventListener);
	}

	public removeEventListener<K extends keyof ParsedEventMap>(
		type: K,
		listener: (this: NcmEventAdapter, ev: ParsedEventMap[K]) => unknown,
	): void {
		this.dispatcher.removeEventListener(type, listener as EventListener);
	}

	private dispatch<K extends keyof ParsedEventMap>(
		type: K,
		detail: ParsedEventMap[K]["detail"],
	): void {
		this.dispatcher.dispatchEvent(new CustomEvent(type, { detail }));
	}

	private _registerNativeEvents(): void {
		this.subscribe("PlayState", this.onRawPlayStateChanged);
		this.subscribe("PlayProgress", this.onRawPlayProgress);
		this.subscribe("Seek", this.onRawSeek);
	}

	private unregisterNativeEvents(): void {
		this.unsubscribe("PlayState", this.onRawPlayStateChanged);
		this.unsubscribe("PlayProgress", this.onRawPlayProgress);
		this.unsubscribe("Seek", this.onRawSeek);
	}

	// 格式:
	// [
	//    "436016471_9RTXWS",
	//    "436016471|pause|IKXYMJ",
	//    2
	// ]
	private readonly onRawPlayStateChanged = (
		playId: string,
		resumeOrPauseId: string,
		state: number,
	): void => {
		logger.debug(
			`onRawPlayStateChanged playId=${playId}, resumeOrPauseId=${resumeOrPauseId}, state=${state}`,
			"EventAdapter",
		);

		let newPlayState: PlaybackStatus | undefined;

		switch (state) {
			case NcmPlayState.PLAYING:
				newPlayState = "Playing";
				break;
			case NcmPlayState.PAUSED:
				newPlayState = "Paused";
				break;
			case NcmPlayState.NULL:
			case NcmPlayState.END:
				newPlayState = "Paused";
				break;
			case NcmPlayState.ERROR:
				logger.warn(
					`播放状态错误: ${state} (playId: ${playId})`,
					"EventAdapter",
				);
				return;
			default:
				logger.warn(
					`未知的播放状态: ${state} (playId: ${playId}, idStr: ${resumeOrPauseId})`,
					"EventAdapter",
				);
				return;
		}

		this.dispatch("playStateChange", newPlayState);
	};

	private readonly onRawPlayProgress = (
		_playId: string,
		currentInSeconds: number,
		/**
		 * 歌曲缓冲进度百分比
		 */
		_cacheProgress: number,
		/**
		 * 未知作用，猜测可能在“一起听”场景下会出现
		 */
		_force?: boolean,
	): void => {
		// logger.trace(
		// 	`onRawPlayProgress playId=${_playId}, currentInSeconds=${currentInSeconds}, cacheProgress=${_cacheProgress}, force=${_force}`,
		// 	"EventAdapter",
		// );
		const progressInMs = Math.floor(currentInSeconds * 1000);
		this.dispatch("progressUpdate", progressInMs);
	};

	// 格式:
	// [
	//    "1991033005_1_7665697221-bitrate-320-TPcU8V",
	//    "1991033005_1_7665697221-bitrate-320-TPcU8V|seek|SNqtFn",
	//    0,
	//    32.59870967741935 // 跳转位置
	// ]
	private readonly onRawSeek = (
		playId: string,
		seekId: string,
		code: number,
		position: number,
	): void => {
		logger.debug(
			`onRawSeek playId=${playId}, seekId=${seekId}, code=${code}, position=${position}`,
			"EventAdapter",
		);

		if (typeof position === "number") {
			const positionInMs = Math.floor(position * 1000);
			this.dispatch("seekUpdate", positionInMs);
		}
	};

	private subscribe<E extends EventName>(
		eventName: E,
		callback: EventMap[E],
	): void {
		const namespace = "audioplayer";
		const fullName = `${namespace}.on${eventName}`;

		let callbackSet = this.legacyCallbacks.get(fullName);
		if (!callbackSet) {
			callbackSet = new Set();
			this.legacyCallbacks.set(fullName, callbackSet);
		}
		callbackSet.add(callback);

		// 其实对于 legacyNativeCmder, 没有必要维护这个复杂的事件多路复用系统
		// 留在这里只是为了以备未来需要直接使用底层的 channel 注册事件
		if (!this.registeredLegacyEvents.has(fullName)) {
			const legacyCallbackSet = new Set<(...args: unknown[]) => void>();
			this.registeredLegacyEvents.set(fullName, legacyCallbackSet);

			const stub = (...args: unknown[]) => {
				this.legacyCallbacks?.get(fullName)?.forEach((cb) => {
					(cb as (...args: unknown[]) => void)(...args);
				});
			};
			legacyCallbackSet.add(stub);

			try {
				this.nativeCmder.appendRegisterCall(eventName, namespace, stub);
			} catch (e) {
				logger.error(
					`注册 NativeCmder 事件 ${eventName} 失败:`,
					"EventAdapter",
					e,
				);
			}
		}
	}

	private unsubscribe<E extends EventName>(
		eventName: E,
		callback: EventMap[E],
	): void {
		const namespace = "audioplayer";
		const fullName = `${namespace}.on${eventName}`;

		const callbackSet = this.legacyCallbacks.get(fullName);
		if (callbackSet) {
			callbackSet.delete(callback);
		}

		const legacyCallbackSet = this.registeredLegacyEvents.get(fullName);
		if (legacyCallbackSet && callbackSet?.size === 0) {
			legacyCallbackSet.forEach((stub) => {
				this.nativeCmder.removeRegisterCall(eventName, namespace, stub);
			});
			this.registeredLegacyEvents.delete(fullName);
			this.legacyCallbacks.delete(fullName);
		}
	}
}
