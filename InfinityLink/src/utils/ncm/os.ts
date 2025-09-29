/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-04-26 17:55:58
 * @modify date 2021-04-26 17:55:58
 *
 * @desc native 命名空间 os 相关 api
 */

/**
 * @description 检测当前网络是否在线
 *
 * @warning 该实现当前有"串号"的风险, 建议采取 id 区分.
 * @returns
 */
export async function isOnline() {
	const p = legacyNativeCmder.createPromiseFromNativeRegisterCall<[boolean]>(
		"isonline",
		"os",
	);
	legacyNativeCmder.call("os.isOnLine");

	return p.then((res) => res?.[0]);
}

/**
 * @description 获取当前的设备信息
 *
 * @warning 该实现当前有"串号"的风险, 建议使用与此等价的流
 * @notice 该方法执行时间较长, 一般留好至少 5s 的 timeout
 *
 * @returns
 */
export async function getDeviceInfo() {
	// const p = legacyNativeCmder.createPromiseFromNativeRegisterCall<[boolean]>('GetDeviceInfo', 'os')
	const p = legacyNativeCmder.createPromiseFromNativeRegisterCall<
		[
			{
				/** @description 设备名, windows 上一般默认是用户名, 但可被用户更改 */
				devicename: string;
				/** @description model 名, windows 上一般默认是电脑型号, 但可被用户更改 */
				model: string;
			},
		]
	>("GetDeviceInfo", "os");
	legacyNativeCmder.call("os.getDeviceInfo");

	return p.then((res) => res?.[0]);
}

/**
 * @description 获取设备 ID, 在客户端签名加密场景有用
 */
export async function getDeviceId() {
	return legacyNativeCmder.call<string>("os.getDeviceId");
}

/**
 * @description 获取 OS 版本, 在客户端签名加密场景有用
 */
export async function queryOsVer() {
	return legacyNativeCmder.call<string>("os.queryOsVer");
}

/**
 * @description 获取系统硬盘空间信息
 *
 * 对 win32 来说, 会取 fspath 的盘符对应的硬盘, 如 "C:\\xxx" 则表明获取 C 盘的空间信息
 * 对 darwin 来说,
 *
 * @see {cloudmusic_win32:orpheus\src\framework\plugin\os\os.cpp}
 * @see {@link:https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdiskfreespacew}
 */
export async function getDiskSpace(fspath: string): Promise<{
	/** @description 总空间 bytes */
	total?: number;
	/** @description 总空间 bytes */
	free?: number;
}> {
	return legacyNativeCmder
		.call<string>("os.getDiskSpace", fspath)
		.then((res) => JSON.parse(res));
}

/**
 * @description 用 shell 打开一个文件系统地址, 可以是文件夹或者文件
 *
 * 如果打开成功则返回 true, 否则返回 false
 */
export async function shellOpen(fspath: string) {
	return legacyNativeCmder.call<boolean>("os.shellOpen", fspath);
}

type IOSSystemInfo = {
	/**
	 * @description 显示器的分辨率 rect 信息
	 */
	monitor: unknown;
	/**
	 * @description 当前窗口的 rect 信息
	 */
	workArea: unknown;
};

type ISystemInfoType =
	/**
	 * @description 显示器(rect)
	 */
	| "monitor"
	/**
	 * @description 获取桌面的信息(rect)
	 */
	| "desktop"
	/**
	 * @description 最近一次输入信息
	 */
	| "lastInputInfo";

/**
 * @description 获取系统信息
 */
export async function getSystemInfo<T extends ISystemInfoType = "monitor">(
	type: T,
) {
	return legacyNativeCmder.call<
		T extends "monitor"
			? IOSSystemInfo
			: T extends "desktop"
				? Omit<IOSSystemInfo, "monitor">
				: T extends "lastInputInfo"
					? number
					: unknown
	>("os.getSystemInfo", type);
}

/**
 * @description 使用系统打开一个外部链接
 */
export async function navigateExternal(url: string) {
	return legacyNativeCmder.call<void>("os.navigateExternal", url);
}

/**
 * @description 检查 fspath 对应的路径是否存在且为文件
 *
 * 只有当 fspath 代表文件(可以是 symbolic link)时返回 true,
 * 否则返回 false
 */
export async function isFileExist(fspath: string) {
	return legacyNativeCmder.call<boolean>("os.isFileExist", fspath);
}

/**
 * @description 尝试以 fspath 对应的路径代表的文件生成 md5
 *
 * 只有当 fspath 代表文件时能成功生成 md5, 否则会返回 ''
 */
export async function getFileMD5(fspath: string) {
	return legacyNativeCmder.call<string>("os.getFileMD5", fspath);
}
