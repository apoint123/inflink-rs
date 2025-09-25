import type { ControlMessage, SongInfo, TimelineInfo } from "../types/smtc";

export type PlayState = "Playing" | "Paused";

interface ProviderEventMap {
	updateSongInfo: CustomEvent<SongInfo>;
	updatePlayState: CustomEvent<PlayState>;
	updateTimeline: CustomEvent<TimelineInfo>;
	control: CustomEvent<ControlMessage>;
	disable: CustomEvent<void>;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: EventTarget 提供了 addEventListener 和 removeEventListener 的实现，这里只是扩充了以下类型
export class BaseProvider extends EventTarget {
	disabled = false;

	override dispatchEvent(event: Event): boolean {
		if (this.disabled) return false;
		return super.dispatchEvent(event);
	}

	dispose() {}
}

export interface BaseProvider {
	addEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (this: BaseProvider, ev: ProviderEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;

	removeEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (this: BaseProvider, ev: ProviderEventMap[K]) => void,
		options?: boolean | EventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void;
}
