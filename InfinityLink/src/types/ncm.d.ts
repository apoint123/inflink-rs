import type { Store } from "redux";

// --- 通用类型 ---
export interface Artist {
	id: string;
	name: string;
}

// --- v3 类型 ---
export namespace v3 {
	/**
	 * Redux Store 中实际存在的播放模式
	 */
	export type PlayMode =
		| "playCycle"
		| "playOneCycle"
		| "playRandom"
		| "playOrder"
		| "playFm"
		| "playAi";

	/** 播放状态的数字表示。1: 已暂停, 2: 播放中 */
	export type PlayState = 1 | 2;

	export interface TrackAlbum {
		id?: string;
		name?: string;
		albumName?: string;
		picUrl?: string;
	}

	export interface CurTrack {
		id?: string;
		name?: string;
		duration?: number;
		album?: TrackAlbum;
		artists?: Artist[];
	}

	export interface PlayingInfo {
		resourceTrackId?: string;
		resourceName?: string;
		resourceArtists?: Artist[];
		resourceCoverUrl?: string;
		playing?: boolean;
		curTrack?: CurTrack;
		playingState?: PlayState;
		playingMode?: PlayMode;
	}

	export interface ReduxState {
		playing: PlayingInfo | null;
	}

	export type NCMStore = Store<ReduxState>;

	export interface ReactRootElement extends HTMLElement {
		_reactRootContainer?: {
			_internalRoot?: {
				current?: {
					child?: {
						child?: {
							memoizedProps?: {
								store?: NCMStore;
							};
						};
					};
				};
			};
		};
	}

	export interface AudioLoadInfo {
		/** 音频总时长，单位：秒 */
		duration: number;
	}

	export interface EventMap {
		Load: (audioId: string, info: AudioLoadInfo) => void;
		End: (audioId: string) => void;
		PlayProgress: (audioId: string, progress: number) => void;
		PlayState: (audioId: string, state: string) => void;
	}

	export type EventName = keyof EventMap;

	export interface AudioPlayer {
		subscribePlayStatus: (options: {
			type: "playprogress";
			callback: (info: {
				playId: string;
				current: number; // 播放进度 (秒)
				cacheProgress: number;
				force: boolean;
			}) => void;
		}) => void;
		unSubscribePlayStatus: (
			callback: (info: {
				playId: string;
				current: number;
				cacheProgress: number;
				force: boolean;
			}) => void,
		) => void;
	}
}

// --- v2 类型 ---
export namespace v2 {
	export interface ReduxAction {
		type: string;
		[key: string]: unknown;
	}

	export interface ReduxPlayingState {
		playMode: string;
		resourceTrackId: number;
	}

	export interface ReduxState {
		playing: ReduxPlayingState;
	}

	export type NCMStore = Store<ReduxState, ReduxAction>;

	export interface PlayerInstance {
		/**
		 * 命令分发函数
		 *
		 * 用于控制播放、暂停、切歌和模式切换等
		 *
		 * @param command 控制命令字符串，例如 'play', 'pause', 'playnext', 'mode_playrandom'
		 */
		KJ: (command: string) => void;

		/**
		 * 跳转到指定的播放进度
		 *
		 * @param progress 播放进度百分比，范围从 0.0 到 1.0
		 */
		Qn: (progress: number) => void;

		/**
		 * 检查当前是否正在播放
		 *
		 * @returns 如果正在播放则返回 true，否则返回 false
		 */
		OT: () => boolean;

		/**
		 * 获取当前活动的播放器实例 (defPlayer, fmPlayer, mvPlayer 等)
		 *
		 * @returns 当前播放器实例，如果没有则返回 null
		 */
		Hn: () => PlayerInstance | null;

		/**
		 * 获取当前的播放进度
		 *
		 * @returns 当前播放时间，单位为秒
		 */
		Gn: () => number;

		/** 当前音轨的总时长，单位为秒 */
		tQ: number;

		/** 包含当前轨道（FM模式不可用）详细信息的对象 */
		x6: PlayerTrack | null;

		/** 获取当前轨道（FM模式下）详细信息的 getter 函数 */
		_t: () => PlayerTrack | null;
	}

	/**
	 * UI相关的接口
	 *
	 * 用它不如用x6.data
	 */
	export interface UiOptions {
		albumId: string;
		albumName: string;
		artistName: string;
		playId: string;
		songName: string;
		songType: string;
		url: string;
	}

	/**
	 * `x6` 的完整结构
	 */
	export interface PlayerTrack {
		bitrate: number;
		data: SongData | null;
		from: unknown | null;
		state: number;
		uiOpts: UiOptions | null;
	}

	export interface Album {
		id: number;
		name: string;
		picId: string;
		picUrl: string;
	}

	/**
	 * 从播放器实例中获取的数据
	 */
	export interface SongData {
		id: number;
		name: string;
		artists: Artist[];
		album: Album;
		duration: number; // 毫秒
		alias: string[]; // 歌曲后缀，说明原曲之类的
	}
}

declare global {
	const ctl: {
		defPlayer: v2.PlayerInstance;
		player: v2.PlayerInstance;
	};
}
