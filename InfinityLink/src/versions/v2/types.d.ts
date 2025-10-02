export interface ReduxAction {
	type: string;
	[key: string]: unknown;
}

interface V2ReduxPlayingState {
	playMode: string;
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
	// 跳转函数 (0 到 1)
	Qn: (progress: number) => void;
	// 如果在播放，返回 true
	OT: () => boolean;
	sL?: HTMLMediaElement | null;
}

declare global {
	const ctl: {
		defPlayer: CtlDefPlayer;
	};
}
