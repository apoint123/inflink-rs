import type { Store } from "redux";

/**
 * UI 中实际存在的播放模式
 */
export type NCMPlayMode = "playCycle" | "playOneCycle" | "playRandom" | "playOrder" | "playFm" | "playAi";

/** 播放状态的数字表示。1: 已暂停, 2: 播放中 */
export type NCMPlayState = 1 | 2;

export interface Artist {
	id: string;
	name: string;
}

export interface NCMPlayingInfo {
	resourceTrackId?: string;
	resourceName?: string;
	resourceArtists?: Artist[];
	musicAlbumName?: string;
	resourceCoverUrl?: string;
	playing?: boolean;
	progress?: number;
	curTrack?: {
		duration?: number;
	};
	playingState?: NCMPlayState;
	playingMode?: NCMPlayMode;
}

export interface NCMReduxState {
	playing: NCMPlayingInfo | null;
}

export type NCMStore = Store<NCMReduxState>;

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

export interface NcmEventMap {
	Load: (audioId: string, info: AudioLoadInfo) => void;
	End: (audioId: string) => void;
	PlayProgress: (audioId: string, progress: number) => void;
	PlayState: (audioId: string, state: string | number) => void;
}

export type NcmEventName = keyof NcmEventMap;
