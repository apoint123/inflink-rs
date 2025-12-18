import type { PlayMode, RepeatMode } from "../types/backend";

/**
 * 负责管理和计算播放模式切换逻辑
 *
 * 用来避免在两个适配器中都重复实现相同的逻辑
 */
export class PlayModeController {
	private lastModeBeforeShuffle: PlayMode | null = null;

	public getNextShuffleMode(currentMode: PlayMode): PlayMode {
		const { targetMode, nextLastModeBeforeShuffle } =
			this.calculateNextShuffleMode(currentMode);
		this.lastModeBeforeShuffle = nextLastModeBeforeShuffle;
		return targetMode;
	}

	public getNextRepeatMode(currentMode: PlayMode): PlayMode {
		const targetMode = this.calculateNextRepeatMode(currentMode);

		if (currentMode.isShuffling) {
			this.lastModeBeforeShuffle = null;
		}

		return targetMode;
	}

	public getRepeatMode(mode: RepeatMode, currentMode: PlayMode): PlayMode {
		// 切换重复模式时强制关闭随机播放，与网易云音乐行为一致
		const targetMode: PlayMode = {
			isShuffling: false,
			repeatMode: mode,
		};

		if (currentMode.isShuffling) {
			this.lastModeBeforeShuffle = null;
		}
		return targetMode;
	}

	private calculateNextShuffleMode(currentMode: PlayMode): {
		targetMode: PlayMode;
		nextLastModeBeforeShuffle: PlayMode | null;
	} {
		const isShuffleOn = currentMode.isShuffling;
		// 切换随机播放时，总是进入列表循环状态
		const targetMode: PlayMode = isShuffleOn
			? (this.lastModeBeforeShuffle ?? {
					isShuffling: false,
					repeatMode: "List",
				})
			: { isShuffling: true, repeatMode: "List" };

		const nextLastModeBeforeShuffle = isShuffleOn ? null : currentMode;

		return { targetMode, nextLastModeBeforeShuffle };
	}

	private calculateNextRepeatMode(currentMode: PlayMode): PlayMode {
		// 如果当前是随机模式，按键行为是退出随机并进入顺序播放
		if (currentMode.isShuffling) {
			return { isShuffling: false, repeatMode: "None" };
		}

		// 否则，在 顺序 -> 列表循环 -> 单曲循环 之间切换
		switch (currentMode.repeatMode) {
			case "None":
				return { isShuffling: false, repeatMode: "List" };
			case "List":
				return { isShuffling: false, repeatMode: "Track" };
			case "Track":
				return { isShuffling: false, repeatMode: "None" };
			// AI 模式下点击循环按钮，切换到列表循环
			default:
				return { isShuffling: false, repeatMode: "List" };
		}
	}
}
