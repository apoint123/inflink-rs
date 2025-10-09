export class DomElementNotFoundError extends Error {
	constructor(public readonly selector: string) {
		super(`使用指定的选择器 ${selector} 未找到任何 DOM 元素`);
		this.name = "DomElementNotFoundError";
	}
}

export class ReduxStoreNotFoundError extends Error {
	constructor(message = "找不到 Redux store") {
		super(message);
		this.name = "ReduxStoreNotFoundError";
	}
}

export class SongNotFoundError extends Error {
	constructor(message = "无法获取当前歌曲信息") {
		super(message);
		this.name = "SongNotFoundError";
	}
}

export class TimelineNotAvailableError extends Error {
	constructor(message = "时间轴信息不可用") {
		super(message);
		this.name = "TimelineNotAvailableError";
	}
}

export type NcmAdapterError =
	| DomElementNotFoundError
	| ReduxStoreNotFoundError
	| SongNotFoundError
	| TimelineNotAvailableError;
