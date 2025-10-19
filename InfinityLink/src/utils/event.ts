import type { OrpheusCommand } from "../types/global";
import type { v3 } from "../types/ncm";
import type { PlaybackStatus } from "../types/smtc";
import logger from "./logger";

export interface ParsedEventMap {
	playStateChange: CustomEvent<PlaybackStatus>;
	progressUpdate: CustomEvent<number>;
	seekUpdate: CustomEvent<number>;
}

export class NcmEventAdapter {
	private readonly dispatcher = new EventTarget();
	private readonly nativeCmder: OrpheusCommand;

	private readonly registeredLegacyEvents = new Map<
		string,
		Set<(...args: unknown[]) => void>
	>();
	private readonly legacyCallbacks = new Map<
		string,
		Set<v3.EventMap[v3.EventName]>
	>();

	constructor(cmder?: OrpheusCommand) {
		this.nativeCmder = cmder || window.legacyNativeCmder;
		this._registerNativeEvents();
	}

	public dispose(): void {
		this._unregisterNativeEvents();
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
		this._subscribe("PlayState", this._onRawPlayStateChanged);
		this._subscribe("PlayProgress", this._onRawPlayProgress);
		this._subscribe("Seek", this._onRawSeek);
	}

	private _unregisterNativeEvents(): void {
		this._unsubscribe("PlayState", this._onRawPlayStateChanged);
		this._unsubscribe("PlayProgress", this._onRawPlayProgress);
		this._unsubscribe("Seek", this._onRawSeek);
	}

	// 格式:
	// {
	//     audioId: "1991033005_1_7665697221-bitrate-320-M236zd",
	//     stateInfo: "1991033005_1_7665697221-bitrate-320-M236zd|pause|rJ0D8z",
	//     timestamp: "1:26:47 AM"
	// }
	private readonly _onRawPlayStateChanged = (
		_audioId: string,
		stateInfo: string,
	): void => {
		const parts = stateInfo.split("|");
		let newPlayState: PlaybackStatus | undefined;

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
					logger.warn(`未知的播放状态: ${stateKeyword}`, "EventAdapter");
					return;
			}
		} else {
			logger.warn(`意外的播放状态: ${stateInfo}`, "EventAdapter");
			return;
		}

		this.dispatch("playStateChange", newPlayState);
	};

	private readonly _onRawPlayProgress = (
		_audioId: string,
		progressInSeconds: number,
	): void => {
		const progressInMs = Math.floor(progressInSeconds * 1000);
		this.dispatch("progressUpdate", progressInMs);
	};

	// 格式:
	// [
	//    "1991033005_1_7665697221-bitrate-320-TPcU8V",
	//    "1991033005_1_7665697221-bitrate-320-TPcU8V|seek|SNqtFn",
	//    0,
	//    32.59870967741935 // 跳转位置
	// ]
	private readonly _onRawSeek = (...payload: unknown[]): void => {
		if (Array.isArray(payload) && payload.length > 0) {
			const positionInSeconds = payload[payload.length - 1];
			if (typeof positionInSeconds === "number") {
				const positionInMs = Math.floor(positionInSeconds * 1000);
				this.dispatch("seekUpdate", positionInMs);
			}
		}
	};

	private _subscribe<E extends v3.EventName>(
		eventName: E,
		callback: v3.EventMap[E],
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

	private _unsubscribe<E extends v3.EventName>(
		eventName: E,
		callback: v3.EventMap[E],
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
