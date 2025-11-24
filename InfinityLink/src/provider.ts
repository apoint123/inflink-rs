import type { ResolutionSetting } from "./hooks";
import type {
	ControlMessage,
	ProviderEventMap,
	VolumeInfo,
} from "./types/smtc";
import type { INcmAdapter, NcmAdapterEventMap } from "./versions/adapter";

export class SmtcProvider {
	public readonly ready: Promise<void>;
	public readonly adapter: INcmAdapter;
	private readonly dispatcher = new EventTarget();

	constructor(adapter: INcmAdapter) {
		this.adapter = adapter;
		this.ready = Promise.resolve();
		this.initialize();
	}

	private initialize(): void {
		this.adapter.addEventListener("songChange", this.onSongChange);
		this.adapter.addEventListener("playStateChange", this.onPlayStateChange);
		this.adapter.addEventListener("playModeChange", this.onPlayModeChange);
		this.adapter.addEventListener("timelineUpdate", this.onTimelineUpdate);
		this.adapter.addEventListener("volumeChange", this.onVolumeChange);
		this.adapter.addEventListener(
			"rawTimelineUpdate",
			this.onRawTimelineUpdate,
		);
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
			case "Stop":
				this.adapter.stop();
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
			case "SetVolume":
				this.adapter.setVolume(msg.level);
				break;
			case "ToggleMute":
				this.adapter.toggleMute();
				break;
			default: {
				const exhaustiveCheck: never = msg;
				console.warn(`[SmtcProvider] 未处理的命令:`, exhaustiveCheck);
				break;
			}
		}
	}

	public setResolution(resolution: ResolutionSetting): void {
		this.adapter.setResolution(resolution);
	}

	public forceDispatchFullState(): void {
		const songInfoResult = this.adapter.getCurrentSongInfo();
		if (songInfoResult.isOk()) {
			this.dispatch("updateSongInfo", songInfoResult.value);
		}

		const playState = this.adapter.getPlaybackStatus();
		this.dispatch("updatePlayState", playState);

		const playMode = this.adapter.getPlayMode();
		this.dispatch("updatePlayMode", playMode);

		const timelineResult = this.adapter.getTimelineInfo();
		if (timelineResult.isOk()) {
			this.dispatch("updateTimeline", timelineResult.value);
		}

		const volume = this.adapter.getVolumeInfo();
		this.dispatch("updateVolume", volume);
	}

	public dispose(): void {
		this.adapter.removeEventListener("songChange", this.onSongChange);
		this.adapter.removeEventListener("playStateChange", this.onPlayStateChange);
		this.adapter.removeEventListener("playModeChange", this.onPlayModeChange);
		this.adapter.removeEventListener("timelineUpdate", this.onTimelineUpdate);
		this.adapter.removeEventListener("volumeChange", this.onVolumeChange);
		this.adapter.removeEventListener(
			"rawTimelineUpdate",
			this.onRawTimelineUpdate,
		);
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

	public getCurrentSongInfo(): ReturnType<INcmAdapter["getCurrentSongInfo"]> {
		return this.adapter.getCurrentSongInfo();
	}

	public getPlaybackStatus(): ReturnType<INcmAdapter["getPlaybackStatus"]> {
		return this.adapter.getPlaybackStatus();
	}

	public getTimelineInfo(): ReturnType<INcmAdapter["getTimelineInfo"]> {
		return this.adapter.getTimelineInfo();
	}

	public getPlayMode(): ReturnType<INcmAdapter["getPlayMode"]> {
		return this.adapter.getPlayMode();
	}

	public getVolume(): VolumeInfo {
		return this.adapter.getVolumeInfo();
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

	private readonly onRawTimelineUpdate = (
		e: NcmAdapterEventMap["rawTimelineUpdate"],
	): void => {
		this.dispatch("rawTimelineUpdate", e.detail);
	};

	private readonly onVolumeChange = (
		e: NcmAdapterEventMap["volumeChange"],
	): void => {
		this.dispatch("updateVolume", e.detail);
	};
}
