import type {
	PlaybackStatus,
	PlayModePayload,
	ProviderEventMap,
	RepeatMode,
	SongInfo,
	TimelineInfo,
} from "./smtc";

/**
 * 可以给其它插件用的接口
 */
export interface IInfLinkApi {
	getPlaybackStatus(): PlaybackStatus;
	getCurrentSong(): SongInfo | null;
	getTimeline(): TimelineInfo | null;
	getPlayMode(): PlayModePayload;

	play(): void;
	pause(): void;
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

	addEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (ev: ProviderEventMap[K]) => unknown,
	): void;

	removeEventListener<K extends keyof ProviderEventMap>(
		type: K,
		listener: (ev: ProviderEventMap[K]) => unknown,
	): void;
}
