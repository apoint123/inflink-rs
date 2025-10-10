import type { v3 } from "../types/ncm";
import type { PlaybackStatus } from "../types/smtc";
import logger from "./logger";

/**
 * 这个事件非常莫名其妙，在v3上使用 `appendRegisterCall` 来注册它会导致 UI 进度条静止
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

export interface ParsedEventMap {
	playStateChange: CustomEvent<PlaybackStatus>;
	progressUpdate: CustomEvent<number>;
	seekUpdate: CustomEvent<number>;
}

export class NcmEventAdapter {
	private readonly ncmVersion: "v2" | "v3";
	private readonly dispatcher = new EventTarget();

	private readonly registeredLegacyEvents = new Map<
		string,
		Set<v3.EventMap[v3.EventName]>
	>();
	private readonly legacyCallbacks = new Map<
		string,
		Set<v3.EventMap[v3.EventName]>
	>();

	constructor(version: "v2" | "v3") {
		this.ncmVersion = version;
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
		// seek 事件也有怪癖，用 appendRegisterCall 注册同样会导致进度条静止
		// 并且进度条的小点还会变成呼吸的红色小点
		if (this.ncmVersion === "v2") {
			this._subscribe("Seek", this._onRawSeek);
		}
	}

	private _unregisterNativeEvents(): void {
		this._unsubscribe("PlayState", this._onRawPlayStateChanged);
		this._unsubscribe("PlayProgress", this._onRawPlayProgress);
		if (this.ncmVersion === "v2") {
			this._unsubscribe("Seek", this._onRawSeek);
		}
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
					logger.warn(`[InfLink-rs] 未知的播放状态: ${stateKeyword}`);
					return;
			}
		} else {
			logger.warn(`[InfLink-rs] 意外的播放状态: ${stateInfo}`);
			return;
		}

		if (newPlayState) {
			this.dispatch("playStateChange", newPlayState);
		}
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

		if (
			this.ncmVersion === "v3" &&
			CHANNEL_EVENTS.has(eventName) &&
			window.channel
		) {
			try {
				window.channel.registerCall(
					fullName,
					callback as (...args: unknown[]) => void,
				);
			} catch (e) {
				logger.error(`[InfLink-rs] 注册 channel 事件 ${eventName} 失败:`, e);
			}
		} else {
			let callbackSet = this.legacyCallbacks.get(fullName);
			if (!callbackSet) {
				callbackSet = new Set();
				this.legacyCallbacks.set(fullName, callbackSet);
			}
			callbackSet.add(callback);

			if (!this.registeredLegacyEvents.has(fullName)) {
				const legacyCallbackSet = new Set<v3.EventMap[v3.EventName]>();
				this.registeredLegacyEvents.set(fullName, legacyCallbackSet);

				const stub = (...args: unknown[]) => {
					this.legacyCallbacks?.get(fullName)?.forEach((cb) => {
						(cb as (...args: unknown[]) => void)(...args);
					});
				};
				legacyCallbackSet.add(stub);

				try {
					legacyNativeCmder.appendRegisterCall(eventName, namespace, stub);
				} catch (e) {
					logger.error(
						`[InfLink-rs] 注册 NativeCmder 事件 ${eventName} 失败:`,
						e,
					);
				}
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
				legacyNativeCmder.removeRegisterCall(eventName, namespace, stub);
			});
			this.registeredLegacyEvents.delete(fullName);
			this.legacyCallbacks.delete(fullName);
		}
	}
}
