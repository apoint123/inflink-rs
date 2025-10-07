import type { ControlMessage, ProviderEventMap } from "./types/smtc";
import type { INcmAdapter, NcmAdapterEventMap } from "./versions/adapter";

export class SmtcProvider {
	public readonly ready: Promise<void>;
	public readonly adapter: INcmAdapter;
	private readonly dispatcher = new EventTarget();

	constructor(adapter: INcmAdapter) {
		this.adapter = adapter;
		this.ready = this.initialize();
	}

	private async initialize(): Promise<void> {
		this.adapter.addEventListener("songChange", this.onSongChange);
		this.adapter.addEventListener("playStateChange", this.onPlayStateChange);
		this.adapter.addEventListener("playModeChange", this.onPlayModeChange);
		this.adapter.addEventListener("timelineUpdate", this.onTimelineUpdate);

		await this.adapter.initialize();
	}

	private dispatch<K extends keyof ProviderEventMap>(
		type: K,
		detail: ProviderEventMap[K]["detail"],
	): void {
		this.dispatcher.dispatchEvent(new CustomEvent(type, { detail }));
	}

	public handleControlCommand(msg: ControlMessage): void {
		switch (msg.type) {
			case "Play":
				this.adapter.play();
				break;
			case "Pause":
				this.adapter.pause();
				break;
			case "NextSong":
				this.adapter.nextSong();
				break;
			case "PreviousSong":
				this.adapter.previousSong();
				break;
			case "Seek":
				this.adapter.seekTo(msg.position);
				break;
			case "ToggleShuffle":
				this.adapter.toggleShuffle();
				break;
			case "ToggleRepeat":
				this.adapter.toggleRepeat();
				break;
			case "SetRepeat":
				this.adapter.setRepeatMode(msg.mode);
				break;
			default: {
				const exhaustiveCheck: never = msg;
				console.warn(`[SmtcProvider] 未处理的命令:`, exhaustiveCheck);
				break;
			}
		}
	}

	public forceDispatchFullState(): void {
		const songInfo = this.adapter.getCurrentSongInfo();
		if (songInfo) {
			this.dispatch("updateSongInfo", songInfo);
		}
		const playState = this.adapter.getPlaybackStatus();
		this.dispatch("updatePlayState", playState);
		const playMode = this.adapter.getPlayMode();
		this.dispatch("updatePlayMode", playMode);
		const timeline = this.adapter.getTimelineInfo();
		if (timeline) {
			this.dispatch("updateTimeline", timeline);
		}
	}

	public dispose(): void {
		this.adapter.removeEventListener("songChange", this.onSongChange);
		this.adapter.removeEventListener("playStateChange", this.onPlayStateChange);
		this.adapter.removeEventListener("playModeChange", this.onPlayModeChange);
		this.adapter.removeEventListener("timelineUpdate", this.onTimelineUpdate);
		this.adapter.dispose();
	}

	public addEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (this: SmtcProvider, ev: ProviderEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void {
		this.dispatcher.addEventListener(type, listener as EventListener, options);
	}

	public removeEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (this: SmtcProvider, ev: ProviderEventMap[K]) => unknown,
		options?: boolean | EventListenerOptions,
	): void {
		this.dispatcher.removeEventListener(
			type,
			listener as EventListener,
			options,
		);
	}

	private readonly onSongChange = (
		e: NcmAdapterEventMap["songChange"],
	): void => {
		this.dispatch("updateSongInfo", e.detail);
	};

	private readonly onPlayStateChange = (
		e: NcmAdapterEventMap["playStateChange"],
	): void => {
		this.dispatch("updatePlayState", e.detail);
	};

	private readonly onPlayModeChange = (
		e: NcmAdapterEventMap["playModeChange"],
	): void => {
		this.dispatch("updatePlayMode", e.detail);
	};

	private readonly onTimelineUpdate = (
		e: NcmAdapterEventMap["timelineUpdate"],
	): void => {
		this.dispatch("updateTimeline", e.detail);
	};
}
