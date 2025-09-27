import mitt, { type Emitter } from "mitt";
import type {
	ControlMessage,
	PlaybackStatus,
	SongInfo,
	TimelineInfo,
} from "../types/smtc";

type ProviderEventMap = {
	updateSongInfo: CustomEvent<SongInfo>;
	updatePlayState: CustomEvent<PlaybackStatus>;
	updateTimeline: CustomEvent<TimelineInfo>;
	control: CustomEvent<ControlMessage>;
	disable: CustomEvent<void>;
};

export class BaseProvider {
	private readonly emitter: Emitter<ProviderEventMap>;

	public disabled = false;

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
		console.log("[BaseProvider] Disposed.");
	}
}
