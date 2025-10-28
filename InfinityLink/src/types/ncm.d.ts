import type { Dispatch, Store } from "redux";

// --- 通用类型 ---
export interface Artist {
	id: string | undefined | null;
	name: string;
}

export interface AudioLoadInfo {
	duration: number;
}

export interface EventMap {
	Load: (audioId: string, info: AudioLoadInfo) => void;
	End: (audioId: string) => void;
	PlayProgress: (
		playId: string,
		current: number,
		cacheProgress: number,
		force?: boolean,
	) => void;
	PlayState: (playId: string, resumeOrPauseId: string, state: number) => void;
	Seek: (
		playId: string,
		seekId: string,
		code: number,
		position: number,
	) => void;
}

export type EventName = keyof EventMap;

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

	/**
	 * 播放状态的数字表示。
	 * - -1: End
	 * - 0: Stop
	 * - 1: Pause
	 * - 2: Playing
	 */
	export type PlayState = -1 | 0 | 1 | 2;

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
		resourceType?: "song" | "voice" | "localTrack";
		curTrack?: CurTrack | null;
		playingState?: PlayState;
		playingMode?: PlayMode;
		playingVolume?: number; // 0-1
		trackFileType?: "local" | string;
		onlineResourceId?: string;
	}

	export interface CurrentVoice {
		id: string;
		name: string;
		coverUrl: string;
		/** 单位毫秒 */
		duration: number;
		radio?: {
			name?: string;
		};
		track?: {
			artists?: Artist[];
		};
	}

	export interface VinylPageInfo {
		currentVoice?: CurrentVoice;
	}

	export interface ReduxState {
		playing: PlayingInfo;
		"page:vinylPage"?: VinylPageInfo;
	}

	/**
	 * triggerScene 应该是用来做数据分析和实现条件逻辑的
	 * 建议派发 actions 时提供一个 triggerScene
	 */
	export type TriggerScene =
		| "playlist"
		| "album"
		| "audio"
		| "audioBook"
		| "event"
		| "artist"
		| "search"
		| "searchBox"
		| "algPlaylist"
		| "userProfile"
		| "comment"
		| "cloud"
		| "local"
		| "download"
		| "downloading"
		| "playingList"
		| "history"
		| "vinyl"
		| "myFavAudio"
		| "myCreateAudio"
		| "myPayedAudio"
		| "musicAudio"
		| "myLikedVoice"
		| "essential"
		| "EssentialRank"
		| "VIPEssential"
		| "video"
		| "myFollow"
		| "listenToSong"
		| "playRecordRankWeek"
		| "playRecordRankAll"
		| "fm"
		| "sceneFm"
		| "dailyRecommend"
		| "recommend"
		| "sceneMusic"
		| "historyRecommend"
		| "styleRecommend"
		| "myCreatePlaylist"
		| "notice"
		| "message"
		| "atMessage"
		| "friendEvent"
		| "newTrackToday"
		| "aiMode"
		| "leftSide"
		| "myFavorite"
		| "miniBar"
		| "desktopLyric"
		| "dragInApp"
		| "blacks"
		| "sysTray"
		| "sysBar"
		| "ipcMessage"
		| "orpheusMessage"
		| "youDaoDictMessage"
		| "hotKey"
		| "miniPlayer"
		| "native"
		| "moreRcmd"
		| "dailyVoice"
		| "recentListen"
		| "playlistHandoff"
		| "listenTogether"
		| "newSongArtist"
		| "newMiniBar"
		| "unknown"
		| "dailyPush"
		| "copyrightReversionPush"
		| "artistRcmd";

	export type NcmV3Action =
		| { type: "playing/resume"; payload: { triggerScene: TriggerScene } }
		| { type: "playing/pause" }
		| {
				type: "playingList/jump2Track";
				payload: { flag: 1 | -1; type: "call"; triggerScene: TriggerScene };
		  }
		| { type: "playing/setPlayingPosition"; payload: { duration: number } }
		| {
				type: "playing/switchPlayingMode";
				payload: { playingMode: PlayMode; triggerScene: TriggerScene };
		  }
		| { type: "playing/setVolume"; payload: { volume: number } }
		| { type: "playing/switchMute" };

	export type NCMStore = Store<ReduxState, NcmV3Action>;

	export interface DvaTool {
		getStore(): ReduxState;
		getDispatch(): Dispatch<NcmV3Action>;
	}

	export interface DvaToolModule {
		a: DvaTool;
	}

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

	export interface LastPlayingInfo {
		cacheProgress?: number;
		current?: number;
		quality?: number;
		resourceDuration?: number;
		resourceId?: string;
		trackId?: string;
	}

	export interface NcmStorageModule {
		lastPlaying: {
			get: () => Promise<LastPlayingInfo | null>;
		};
	}

	export interface NcmStorageContainer {
		b: NcmStorageModule;
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
		resourceType?: "song" | "local" | "voice";
		/**
		 * 播放状态
		 *
		 * - -1: End
		 * - 0: Stop
		 * - 1: Pause
		 * - 2: Playing
		 */
		playingState: -1 | 0 | 1 | 2;
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

		/** 统一获取当前轨道信息的对象 */
		MF: {
			U: () => PlayerTrack | null;
		};
	}

	/**
	 * UI相关的接口
	 *
	 * 建议用 `x6.data`, 或者 `MF.U()`
	 *
	 * 因为这个接口的 `artistName` 是扁平的,
	 * 不好应对多个艺术家的情况
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
		from: {
			lrcid?: number;
		} | null;
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
		id: number | string;
		name: string;
		artists: Artist[];
		album: Album;
		duration: number; // 毫秒
		alias: string[]; // 歌曲后缀，说明原曲之类的
		programId?: number; // 适用于播客的ID
		radio?: Radio; // 播客的相关对象
	}

	export interface Radio {
		name: string;
		picUrl: string;
	}

	export interface CefPlayerVolumePayload {
		volume: number; // 0-1
	}

	export interface CefPlayerMutePayload {
		mute: boolean;
	}

	export interface CefPlayerEventMap {
		onvolumechange: (payload: CefPlayerVolumePayload) => void;
		onmutechange: (payload: CefPlayerMutePayload) => void;
	}

	export interface CefPlayer {
		/** 获取当前音量 (0-1) */
		K6: () => number;
		/** 设置音量 (0-1) */
		F6: (level: number) => void;
		/**
		 * 设置静音状态
		 * @param mute true 为静音, false 为取消静音
		 */
		T6: (mute: boolean) => void;
		/** 当前是否静音 */
		a6: boolean;
		/**
		 * 监听播放器事件
		 * @param eventName 事件名称, 如 'onvolumechange', 'onmutechange'
		 * @param callback 事件回调函数
		 */
		Ti<K extends keyof CefPlayerEventMap>(
			eventName: K,
			callback: CefPlayerEventMap[K],
		): void;
		/**
		 * 移除播放器事件监听
		 * @param eventName 事件名称
		 * @param callback 注册时使用的同一个回调函数
		 */
		Ii<K extends keyof CefPlayerEventMap>(
			eventName: K,
			callback: CefPlayerEventMap[K],
		): void;
	}

	/**
	 * 从 dc.program.$ 缓存中获取的播客/电台节目数据结构
	 */
	export interface ProgramCacheData {
		id: number;
		name: string;
		coverUrl: string;
		dj?: {
			nickname: string;
		};
		radio?: {
			name: string;
		};
	}
}

declare global {
	const ctl: {
		defPlayer: v2.PlayerInstance;
		player: v2.PlayerInstance;
		cefPlayer: v2.CefPlayer;
	};
	const dc: {
		program: {
			/**
			 * 从内部缓存获取节目详情
			 * @param id 节目 ID (programId)
			 * @returns 缓存中的节目数据，如果未找到则返回 null 或 undefined
			 */
			$: (id: number | string) => v2.ProgramCacheData | null | undefined;
		};
	};
}
