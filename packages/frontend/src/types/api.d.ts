/**
 * @fileoverview InfLink-rs Plugin API
 *
 * 供其他插件使用的类型定义文件
 * 将此文件复制到你的项目中即可获得 InfLink-rs 暴露的 `window.InfLinkApi` 的类型提示
 */

export type PlaybackStatus = "Playing" | "Paused";

export interface CoverInfo {
	blob?: Blob | undefined;
	url?: string | undefined;
}

export interface SongInfo {
	songName: string;
	albumName: string;
	authorName: string;
	cover: CoverInfo | null;
	/** 歌曲ID */
	ncmId: number;
	/** 单位毫秒 */
	duration?: number | undefined;
}

export interface TimelineInfo {
	/** 单位毫秒 */
	currentTime: number;
	/** 单位毫秒 */
	totalTime: number;
}

export interface VolumeInfo {
	/**
	 * 0 ~ 1 的浮点数
	 */
	volume: number;
	isMuted: boolean;
}

export type RepeatMode = "None" | "Track" | "List" | "AI";

export interface PlayMode {
	isShuffling: boolean;
	repeatMode: RepeatMode;
}

export interface AudioDataInfo {
	/**
	 * 原始音频数据
	 *
	 * 这是一个 48000Hz int16 2通道的 PCM 数据
	 */
	data: ArrayBuffer;
	/**
	 * 数据对应的时间戳，单位为毫秒
	 */
	pts: number;
}

export interface PlaybackEventMap {
	songChange: CustomEvent<SongInfo>;
	playStateChange: CustomEvent<PlaybackStatus>;
	timelineUpdate: CustomEvent<TimelineInfo>;
	rawTimelineUpdate: CustomEvent<TimelineInfo>;
	playModeChange: CustomEvent<PlayMode>;
	volumeChange: CustomEvent<VolumeInfo>;

	/**
	 * C++ 后端抛出的音频数据
	 *
	 * 注意监听此事件可能会对性能有一定影响
	 */
	audioDataUpdate: CustomEvent<AudioDataInfo>;
}

/**
 * 可以给其它插件用的接口
 */
export interface IInfLinkApi {
	getPlaybackStatus(): PlaybackStatus;
	getCurrentSong(): SongInfo | null;
	getTimeline(): TimelineInfo | null;
	getPlayMode(): PlayMode;
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

	addEventListener<K extends keyof PlaybackEventMap>(
		type: K,
		listener: (ev: PlaybackEventMap[K]) => void,
	): void;

	removeEventListener<K extends keyof PlaybackEventMap>(
		type: K,
		listener: (ev: PlaybackEventMap[K]) => void,
	): void;
}

declare global {
	interface Window {
		/**
		 * InfLink-rs 插件提供的、可供其他插件使用的接口
		 */
		InfLinkApi?: IInfLinkApi;
	}
}
