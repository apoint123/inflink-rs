import mitt, { type Emitter } from "mitt";
import type {
	ControlMessage,
	PlaybackStatus,
	PlayModePayload,
	SongInfo,
	TimelineInfo,
} from "../types/smtc";
import logger from "../utils/logger";

type ProviderEventMap = {
	updateSongInfo: CustomEvent<SongInfo>;
	updatePlayState: CustomEvent<PlaybackStatus>;
	updateTimeline: CustomEvent<TimelineInfo>;
	updatePlayMode: CustomEvent<PlayModePayload>;
	control: CustomEvent<ControlMessage>;
	disable: CustomEvent<void>;
};

export class BaseProvider {
	private readonly emitter: Emitter<ProviderEventMap>;

	public disabled = false;

	public ready: Promise<void> = Promise.resolve();

	/**
	 * 强制分发所有当前状态的事件
	 *
	 * 用于在插件启动时或者用户重新打开了 SMTC 功能时同步所有信息
	 */
	public forceDispatchFullState(): void {
		// 空实现
	}

	constructor() {
		this.emitter = mitt<ProviderEventMap>();
	}

	public addEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (ev: ProviderEventMap[K]) => void,
	): void {
		this.emitter.on(type, listener);
	}

	public removeEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (ev: ProviderEventMap[K]) => void,
	): void {
		this.emitter.off(type, listener);
	}

	public dispatchEvent(event: Event): boolean {
		if (this.disabled) return false;

		const type = event.type as keyof ProviderEventMap;
		this.emitter.emit(type, event as ProviderEventMap[typeof type]);

		return true;
	}

	public dispose(): void {
		this.emitter.all.clear();
		logger.debug("[BaseProvider] Disposed.");
	}
}
