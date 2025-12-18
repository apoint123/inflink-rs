import type {
	InfLinkEventMap,
	PlaybackStatus,
	PlayModePayload,
	RepeatMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "./backend";

/**
 * 可以给其它插件用的接口
 */
export interface IInfLinkApi {
	getPlaybackStatus(): PlaybackStatus;
	getCurrentSong(): SongInfo | null;
	getTimeline(): TimelineInfo | null;
	getPlayMode(): PlayModePayload;
	getVolume(): VolumeInfo;

	play(): void;
	pause(): void;
	stop(): void;
	next(): void;
	previous(): void;
	seekTo(positionMs: number): void;

	toggleShuffle(): void;
	/**
	 * 切换循环播放模式 (顺序播放 -> 列表循环 -> 单曲循环)
	 */
	toggleRepeat(): void;
	/**
	 * 设置循环播放模式
	 * @param mode "None" | "Track" | "List" | "AI"
	 */
	setRepeatMode(mode: RepeatMode): void;

	/**
	 * 设置音量
	 * @param level 音量大小，范围从 0.0 到 1.0
	 */
	setVolume(level: number): void;
	toggleMute(): void;

	addEventListener<K extends keyof InfLinkEventMap>(
		type: K,
		listener: (ev: InfLinkEventMap[K]) => unknown,
	): void;

	removeEventListener<K extends keyof InfLinkEventMap>(
		type: K,
		listener: (ev: InfLinkEventMap[K]) => unknown,
	): void;
}
