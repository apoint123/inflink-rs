import type { RepeatMode } from "../types/smtc";
import {
	calculateNextRepeatMode,
	calculateNextShuffleMode,
} from "../utils/playModeLogic";

export interface NcmPlayModeConstants {
	SHUFFLE: string;
	LOOP: string;
	ONE_LOOP: string;
	ORDER: string;
	AI: string;
}

/**
 * 负责管理和计算播放模式切换逻辑
 *
 * 用来避免在两个适配器中都重复实现相同的逻辑
 */
export class PlayModeController {
	private lastModeBeforeShuffle: string | null = null;
	private readonly constants: NcmPlayModeConstants;

	constructor(constants: NcmPlayModeConstants) {
		this.constants = constants;
	}

	public getNextShuffleMode(currentMode: string): string {
		const { targetMode, nextLastModeBeforeShuffle } = calculateNextShuffleMode(
			currentMode,
			this.lastModeBeforeShuffle,
			this.constants,
		);
		this.lastModeBeforeShuffle = nextLastModeBeforeShuffle;
		return targetMode;
	}

	public getNextRepeatMode(currentMode: string): string {
		const targetMode = calculateNextRepeatMode(currentMode, this.constants);

		if (currentMode === this.constants.SHUFFLE) {
			this.lastModeBeforeShuffle = null;
		}
		return targetMode;
	}

	public getRepeatMode(mode: RepeatMode, currentMode: string): string {
		let targetMode: string;
		switch (mode) {
			case "List":
				targetMode = this.constants.LOOP;
				break;
			case "Track":
				targetMode = this.constants.ONE_LOOP;
				break;
			case "AI":
				targetMode = this.constants.AI;
				break;
			default:
				targetMode = this.constants.ORDER;
				break;
		}

		if (currentMode === this.constants.SHUFFLE) {
			this.lastModeBeforeShuffle = null;
		}
		return targetMode;
	}
}
