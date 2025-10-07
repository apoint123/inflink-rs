/**
 * 不同版本的网易云用的播放模式字符串常量
 */
export interface PlayModeConstants {
	SHUFFLE: string;
	LOOP: string;
	ONE_LOOP: string;
	ORDER: string;
}

/**
 * 计算切换随机播放后的下一个模式
 *
 * @param currentMode 当前的播放模式字符串
 * @param lastModeBeforeShuffle 进入随机播放前的模式
 * @param constants 当前版本所使用的常量
 * @returns 包含下一个目标模式和更新后的 lastModeBeforeShuffle 的对象
 */
export function calculateNextShuffleMode(
	currentMode: string,
	lastModeBeforeShuffle: string | null,
	constants: PlayModeConstants,
): { targetMode: string; nextLastModeBeforeShuffle: string | null } {
	const isShuffleOn = currentMode === constants.SHUFFLE;
	const targetMode = isShuffleOn
		? lastModeBeforeShuffle || constants.LOOP
		: constants.SHUFFLE;

	const nextLastModeBeforeShuffle = isShuffleOn ? null : currentMode;

	return { targetMode, nextLastModeBeforeShuffle };
}

/**
 * 计算切换循环播放后的下一个模式
 *
 * @param currentMode 当前的播放模式字符串
 * @param constants 当前版本所使用的常量
 * @returns 下一个目标模式字符串
 */
export function calculateNextRepeatMode(
	currentMode: string,
	constants: PlayModeConstants,
): string {
	// 如果当前是随机模式，退出随机并进入顺序播放
	if (currentMode === constants.SHUFFLE) {
		return constants.ORDER;
	}

	// 否则，在 顺序 -> 列表循环 -> 单曲循环 之间切换
	switch (currentMode) {
		case constants.ORDER:
			return constants.LOOP;
		case constants.LOOP:
			return constants.ONE_LOOP;
		case constants.ONE_LOOP:
			return constants.ORDER;
		default:
			return constants.LOOP; // 默认回到列表循环
	}
}
