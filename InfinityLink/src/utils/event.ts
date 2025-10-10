import type { v3 } from "../types/ncm";
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

export class NcmEventAdapter {
	private readonly ncmVersion: "v2" | "v3";

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
	}

	public on<E extends v3.EventName>(
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

	public off<E extends v3.EventName>(
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
