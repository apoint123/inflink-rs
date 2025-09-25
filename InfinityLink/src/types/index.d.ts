import type { Store } from "redux";

/**
 * UI 中实际存在的播放模式
 */
export type NCMPlayMode = "order" | "loop" | "shuffle" | "singleloop";

export enum PlayMode {
	Order = "order",
	Repeat = "repeat",
	Random = "random",
	One = "one",
	AI = "AI",
}

export interface LegacyNativeCmder {
	appendRegisterCall: (
		name: string,
		namespace: string,
		callback: (...args: unknown[]) => void,
	) => void;
	_envAdapter: {
		callAdapter: (
			method: string,
			callback: () => void,
			args: unknown[],
		) => void;
	};
}

export interface Channel {
	registerCall: (name: string, callback: (...args: unknown[]) => void) => void;
}

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
	progress?: number; // 秒
	curTrack?: {
		duration?: number; // 毫秒
	};
	playingState?: 1 | 2; // 1: Playing, 2: Paused
	playingMode?: string;
}

export interface NCMReduxState {
	playing: NCMPlayingInfo | null;
}

export type NCMStore = Store<NCMReduxState>;

export interface AudioLoadInfo {
	duration: number; // 秒
}

export interface NcmEventMap {
	Load: (audioId: string, info: AudioLoadInfo) => void;
	End: (audioId: string) => void;
	PlayProgress: (audioId: string, progress: number) => void;
	PlayState: (audioId: string, state: string | number) => void;
}

export type NcmEventName = keyof NcmEventMap;

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
