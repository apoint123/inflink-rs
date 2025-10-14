/**
 * @fileoverview 封装网易云音乐 v3 客户端内部的 `AudioPlayer` 模块
 *
 * 此文件用来为网易云内部的 `AudioPlayer` 模块提供一个易用的接口。
 * `AudioPlayer` 模块本身提供了一个高级的 `subscribePlayStatus` 方法，
 * 可以订阅许多种事件，并返回已解析好的参数对象，使用它可以简化逻辑。
 *
 * 此文件目前未使用，因为 `AudioPlayer.unSubscribePlayStatus` 有内存泄露的问题 (它只会清除
 * PlayState 事件的监听器)，并且 Bridge 自己的 appendRegisterCall 和 removeRegisterCall
 * 也能用来注册和反注册需要的事件，所以此文件基本上只用来备用或者做参考
 */

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
	 *
	 * @param options.type - 订阅的事件类型
	 * @param options.callback - 事件回调
	 */
	subscribePlayStatus(options: {
		type: PlayStatusEventType;
		callback: (info: PlayStatusEventPayload) => void;
	}): void;

	/**
	 * 取消订阅播放器状态
	 *
	 * @param callback - 注册时使用的同一个回调函数
	 * @warn 网易云内部实现只处理 "PlayState" 事件的取消订阅
	 */
	unSubscribePlayStatus(callback: (info: PlayStatusEventPayload) => void): void;
}

type AudioPlayerCallback = (info: PlayStatusEventPayload) => void;
type EventType = PlayStatusEventType;

export class AudioPlayerWrapper {
	private readonly audioPlayer: AudioPlayer;
	private readonly subscriptions = new Map<
		EventType,
		Set<AudioPlayerCallback>
	>();

	constructor(audioPlayer: AudioPlayer) {
		this.audioPlayer = audioPlayer;
	}

	/**
	 * 订阅一个播放器事件
	 *
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
	 *
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
