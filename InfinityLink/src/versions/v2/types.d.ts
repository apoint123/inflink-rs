import type { Artist } from "../../types/ncm-internal";

export interface ReduxAction {
	type: string;
	[key: string]: unknown;
}

interface V2ReduxPlayingState {
	playMode: string;
	resourceTrackId: number;
}

interface V2ReduxState {
	playing: V2ReduxPlayingState;
}

export interface V2NCMStore {
	getState: () => V2ReduxState;
	subscribe: (listener: () => void) => () => void;
	dispatch: (action: ReduxAction) => ReduxAction;
}

interface CtlDefPlayer {
	// 命令分发函数
	KJ: (command: string) => void;
	// 跳转函数 (百分比)
	Qn: (progress: number) => void;
	// 如果在播放，返回 true
	OT: () => boolean;
	// 获取当前播放器实例
	Hn: () => CtlDefPlayer | null;
	// 获取播放进度 (秒)
	Gn: () => number;
	// 总时长 (秒)
	tQ: number;
	// 包含歌曲信息的属性
	x6: NcmPlayerTrack | null;
	// 用来在私人漫游 (代码内部称其为 FM 模式) 模式下获取播放对象的 getter 函数
	_t: () => NcmPlayerTrack | null;
}

/**
 * UI相关的接口
 *
 * 用它不如用x6.data
 */
export interface NcmUiOptions {
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
export interface NcmPlayerTrack {
	bitrate: number;
	data: NcmSongData | null;
	from: NcmTrackSource | null;
	state: number;
	uiOpts: NcmUiOptions | null;
}

export interface NcmAlbum {
	id: number;
	name: string;
	picId: string;
	picUrl: string;
}

/**
 * 从播放器实例中获取的数据
 */
export interface NcmSongData {
	id: number;
	name: string;
	artists: Artist[];
	album: NcmAlbum;
	duration: number; // 毫秒
	alias: string[]; // 歌曲后缀，说明原曲之类的
}

declare global {
	const ctl: {
		defPlayer: CtlDefPlayer;
		player: CtlDefPlayer;
	};
}
