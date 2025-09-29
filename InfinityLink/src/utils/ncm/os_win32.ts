/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-04-26 17:55:58
 * @modify date 2021-04-26 17:55:58
 *
 * @desc native 命名空间 os 相关 api
 */

/**
 * @description 获取广告设备 ID
 */
export async function getADDeviceID() {
	return legacyNativeCmder.call<string>("os.getADDeviceID");
}

/**
 * @description 用 explorer 打开一个文件系统地址, 可以是文件夹或者文件
 *
 * 如果打开成功则返回 true, 否则返回 false
 */
export async function shellExplor(fspath: string) {
	return legacyNativeCmder.call<boolean>("os.shellExplor", fspath);
}

/**
 * @description 通过命令行去调用系统 ping 命令
 *
 * ping <arg>
 *
 * 返回命令行执行后打印到 tty 文本行数组
 *
 */
export async function ping(arg: string) {
	const p =
		legacyNativeCmder.createPromiseFromOrpheusEvent<string[]>("os.onping");
	legacyNativeCmder.call<[boolean]>("os.ping", arg);

	return p;
}

/**
 * @description 通过命令行去调用系统 tracert 命令
 *
 * tracert <arg>
 *
 * 返回命令行执行后打印到 tty 文本行数组
 *
 * @deprecated
 */
export async function tracert(arg: string) {
	const p =
		legacyNativeCmder.createPromiseFromOrpheusEvent<string[]>("os.ontracert");
	legacyNativeCmder.call<[boolean]>("os.tracert", arg);

	return p;
}

/**
 * @description 无意义的命令
 *
 * @deprecated 无意义的命令
 */
export async function computerSystemInfo() {
	return legacyNativeCmder.call<void>("os.computerSystemInfo");
}

/**
 * @description 根据 keycode 获取键盘某个键的状态
 *
 * 原理是使用 GetKeyboardState, 因此依赖于某个键位"被按下"的状态是否还在
 * 键盘消息事件队列中. 因此, 对于那些按得频繁的键(比如字母区或 enter 这样的键),
 * 使用该方法拿到的状态不一定反映了实时状态.
 *
 * 常用语获取那些不常按到的键(比如 num lock, caps lock 这类有设置意味的键)的状态
 *
 * @see {@link:https://keycode.info/}
 */
export async function getKeyboardState(keycode: number) {
	return legacyNativeCmder.call<void>("os.getKeyboardState", keycode);
}

/**
 * @description 获取 windows 系统版本, 比如 7, 8, 10
 *
 * @deprecated 该方法意义已弃用
 */
export async function getOsVer() {
	return legacyNativeCmder.call<number>("os.getOsVer");
}

/**
 * @description 获取 windows 系统设置的字体
 */
export async function querySystemFonts() {
	return legacyNativeCmder
		.call<["success", string[]] | ["null_fonts"]>("os.querySystemFonts")
		.then((retValue) => {
			const [res, fonts] = retValue;

			return {
				isSuccess: res === "success",
				fonts: fonts || [],
				// retValue
			};
		});
}

/**
 * @description 检查一批字体是否被系统支持
 *
 * 一般主要是检测范围在命名 `/[\u4E00-\u9FA5]/` 内的中文字体是否被系统支持
 */
export async function checkNativeSupportFonts(fonts: string[]) {
	return legacyNativeCmder
		.call<["success", string[]] | ["Query failed." | "Param Error"]>(
			"os.checkNativeSupportFonts",
			...fonts,
		)
		.then((retValue) => {
			const [res, fonts] = retValue;

			return {
				isSuccess: res === "success",
				fonts: fonts || [],
				// retValue
			};
		});
}

/**
 * @description 在 timeMS ms 之后自动关闭 windows 系统
 *
 * 如果 timeMS <= 0, 表明停止自动关闭 windows 系统
 */
export async function exitWindowSystem(timeMS: number) {
	if (timeMS <= 0) {
		return legacyNativeCmder.call<void>("os.exitWindowSystem", timeMS);
	}

	const p = legacyNativeCmder.createPromiseFromNativeRegisterCall<[boolean]>(
		"onExitWindowSystem",
		"os",
	);
	legacyNativeCmder.call<void>("os.exitWindowSystem", timeMS);

	return p;
}

/**
 * @description 检查离自动关闭 windows 系统还有多少时间, 单位 ms
 *
 * 如果并未开始进行"自动关闭"的程序, 返回 -1
 */
export async function exitWindowSystemLeftTime() {
	return legacyNativeCmder.call<number>("os.exitWindowSystemLeftTime");
}

// getFilePathSize
