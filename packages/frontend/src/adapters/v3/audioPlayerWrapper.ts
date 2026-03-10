/**
 * @fileoverview 封装网易云音乐 v3 客户端内部的 `AudioPlayer` 模块
 *
 * 此文件用来为网易云内部的 `AudioPlayer` 模块提供一个易用的接口。
 * `AudioPlayer` 模块本身提供了一个高级的 `subscribePlayStatus` 方法，
 * 可以订阅许多种事件，并返回已解析好的参数对象，使用它可以简化逻辑。
 */

import type { AudioDataInfo } from "@/types/api";
import logger from "@/utils/logger";

export type PlayStatusEventType =
	| "playstate"
	| "end"
	| "playprogress"
	| "buffering"
	| "seek";

export interface PlayProgressInfo {
	playId: string;
	current: number;
	cacheProgress: number;
	force: boolean;
}

export interface SeekInfo {
	playId: string;
	seekId: string;
	code: number;
	position: number;
}

export interface PlayStateInfo {
	playId: string;
	resumeOrPauseId: string;
	state: "play" | "pause" | "resume" | string;
}

export interface EndInfo {
	playId: string;
	info: string;
}

export interface BufferingInfo {
	playId: string;
	state: unknown;
}

export type PlayStatusEventPayload =
	| PlayProgressInfo
	| SeekInfo
	| PlayStateInfo
	| EndInfo
	| BufferingInfo;

export interface AudioPlayer {
	/**
	 * 订阅播放器状态
	 * @param options.type - 订阅的事件类型
	 * @param options.callback - 事件回调
	 */
	subscribePlayStatus(options: {
		type: PlayStatusEventType;
		callback: (info: PlayStatusEventPayload) => void;
	}): void;

	/**
	 * 取消订阅播放器状态
	 * @param callback - 注册时使用的同一个回调函数
	 * @warn 网易云内部实现只处理 "PlayState" 事件的取消订阅
	 */
	unSubscribePlayStatus(callback: (info: PlayStatusEventPayload) => void): void;

	/**
	 * 设置网易云内置的 SMTC 是否启用
	 *
	 * 只有 3.1.21 及以上的网易云客户端才有 SMTC 支持
	 *
	 * 如果在网易云启动的时候启用smtc，禁用后也可以再次启用，
	 * 但如果在网易云启动的时候没有启用smtc，之后就无法再次启用了
	 */
	setSMTCEnable?(enabled: boolean): void;

	/**
	 * 是否让后端抛出音频数据
	 *
	 * 一般用于音频可视化，由于开销比较大，建议只在必要时启用
	 * @param enabled 是否开启
	 */
	setAudioDataEnableState?(enabled: boolean): void;

	subscribeAudioData?(callback: (data: AudioDataInfo) => void): boolean;
	unsubscribeAudioData?(): void;
}

type AudioPlayerCallback = (info: PlayStatusEventPayload) => void;
type EventType = PlayStatusEventType;

export class AudioPlayerWrapper {
	private readonly audioPlayer: AudioPlayer;
	private readonly subscriptions = new Map<
		EventType,
		Set<AudioPlayerCallback>
	>();

	private originalSetAudioDataEnableState?: (enabled: boolean) => void;
	private originalSubscribeAudioData?: (
		callback: (data: AudioDataInfo) => void,
	) => boolean;
	private originalUnsubscribeAudioData?: () => void;

	private isNcmAudioDataEnabled = false;
	private isPluginAudioDataEnabled = false;
	private isInternalSubscribed = false;

	/**
	 * 专门存放网易云自己的音频数据回调
	 */
	private readonly nativeAudioDataCallbacks = new Set<
		(data: AudioDataInfo) => void
	>();

	/**
	 * 存放我们插件的消费者回调
	 */
	private pluginAudioDataCallback: ((data: AudioDataInfo) => void) | undefined;

	constructor(audioPlayer: AudioPlayer) {
		this.audioPlayer = audioPlayer;
		this.patchAudioDataMethods();
	}

	/**
	 * 设置网易云内置的 SMTC 是否启用
	 * @param enabled 是否启用
	 */
	public setSmtcEnabled(enabled: boolean): void {
		this.audioPlayer.setSMTCEnable?.(enabled);
	}

	/**
	 * 检查是否支持控制 SMTC
	 * @returns 如果客户端支持 SMTC 则返回 true
	 */
	public hasSmtcSupport(): boolean {
		return typeof this.audioPlayer.setSMTCEnable === "function";
	}

	/**
	 * 拦截并接管所有的音频数据控制方法
	 */
	private patchAudioDataMethods(): void {
		// 拦截网易云前端对 C++ 是否抛出音频数据的开关
		// 以免在我们还需要音频数据的时候，用户开关了歌词页那些有动效的皮肤
		// 导致网易云调用这个关掉整个后端的音频数据抛出
		if (typeof this.audioPlayer.setAudioDataEnableState === "function") {
			this.originalSetAudioDataEnableState =
				this.audioPlayer.setAudioDataEnableState.bind(this.audioPlayer);
			this.audioPlayer.setAudioDataEnableState = (enabled: boolean) => {
				this.isNcmAudioDataEnabled = enabled;
				this.syncAudioDataEnableState();
			};
		}

		// 网易云的 subscribeAudioData 方法使用的是 registerCallOnce 来注册回调，
		// 第二次调用时会什么也不做，猴子补丁以便我们知道网易云是否订阅了音频数据
		if (typeof this.audioPlayer.subscribeAudioData === "function") {
			this.originalSubscribeAudioData =
				this.audioPlayer.subscribeAudioData.bind(this.audioPlayer);
			this.audioPlayer.subscribeAudioData = (
				callback: (data: AudioDataInfo) => void,
			) => {
				this.nativeAudioDataCallbacks.add(callback);
				this.evaluateInternalSubscription();
				return true;
			};
		}

		// 由于网易云预期只会有唯一一个音频数据回调，因此 unsubscribeAudioData
		// 的行为是清空所有回调 也需要猴子补丁以免网易云清空掉所有的 包括我们自己的回调
		if (typeof this.audioPlayer.unsubscribeAudioData === "function") {
			this.originalUnsubscribeAudioData =
				this.audioPlayer.unsubscribeAudioData.bind(this.audioPlayer);
			this.audioPlayer.unsubscribeAudioData = () => {
				this.nativeAudioDataCallbacks.clear();
				this.evaluateInternalSubscription();
			};
		}
	}

	/**
	 * 供 V3 适配器调用，注册插件侧的监听需求
	 */
	public setPluginAudioDataCallback(
		callback?: (data: AudioDataInfo) => void,
	): void {
		this.pluginAudioDataCallback = callback;
		this.isPluginAudioDataEnabled = !!callback;

		this.syncAudioDataEnableState();
		this.evaluateInternalSubscription();
	}

	/**
	 * 同步最终的启用状态给 C++ 后端
	 *
	 * 只要网易云自身或插件有一方需要，就保持开启
	 */
	private syncAudioDataEnableState(): void {
		const shouldEnable =
			this.isNcmAudioDataEnabled || this.isPluginAudioDataEnabled;
		this.originalSetAudioDataEnableState?.(shouldEnable);
	}

	/**
	 * 综合评估是否需要占用网易云的单例名额去请求底层音频数据
	 */
	private evaluateInternalSubscription(): void {
		const needsSubscription =
			this.nativeAudioDataCallbacks.size > 0 || !!this.pluginAudioDataCallback;

		if (needsSubscription && !this.isInternalSubscribed) {
			this.isInternalSubscribed = true;
			this.originalSubscribeAudioData?.(this.internalAudioDataCallback);
		} else if (!needsSubscription && this.isInternalSubscribed) {
			this.isInternalSubscribed = false;
			this.originalUnsubscribeAudioData?.();
		}
	}

	/**
	 * 接管底层的唯一回调，负责将数据多路派发给所有消费者
	 */
	private readonly internalAudioDataCallback = (
		payload: AudioDataInfo,
	): void => {
		for (const callback of this.nativeAudioDataCallbacks) {
			try {
				callback(payload);
			} catch (e) {
				logger.warn("执行网易云的回调时出现错误", "AudioPlayerWrapper", e);
			}
		}

		if (this.pluginAudioDataCallback && payload) {
			if (payload.data instanceof ArrayBuffer) {
				try {
					this.pluginAudioDataCallback({
						data: payload.data,
						pts: payload.pts,
					});
				} catch (e) {
					logger.warn("执行插件的回调时出现错误", "AudioPlayerWrapper", e);
				}
			}
		}
	};

	/**
	 * 订阅一个播放器事件
	 * @param type 事件类型
	 * @param callback 回调函数
	 */
	public subscribe(type: EventType, callback: AudioPlayerCallback): void {
		let callbackSet = this.subscriptions.get(type);
		if (!callbackSet) {
			callbackSet = new Set();
			this.subscriptions.set(type, callbackSet);
		}

		if (!callbackSet.has(callback)) {
			callbackSet.add(callback);
			this.audioPlayer.subscribePlayStatus({ type, callback });
		}
	}

	/**
	 * 取消订阅一个播放器事件
	 * @param type 事件类型
	 * @param callback 注册时使用的同一个回调函数
	 */
	public unsubscribe(type: EventType, callback: AudioPlayerCallback): void {
		const callbackSet = this.subscriptions.get(type);
		if (callbackSet?.has(callback)) {
			this.audioPlayer.unSubscribePlayStatus(callback);
			callbackSet.delete(callback);
			if (callbackSet.size === 0) {
				this.subscriptions.delete(type);
			}
		}
	}

	public dispose(): void {
		for (const [, callbackSet] of this.subscriptions.entries()) {
			for (const callback of callbackSet) {
				this.audioPlayer.unSubscribePlayStatus(callback);
			}
		}
		this.subscriptions.clear();
	}
}
