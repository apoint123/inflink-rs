export interface ReduxAction {
	type: string;
	[key: string]: unknown;
}

interface V2ReduxPlayingState {
	playMode: string;
	resourceTrackId: string | number;
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
}

declare global {
	const ctl: {
		defPlayer: CtlDefPlayer;
		player: CtlPlayer;
	};
}
