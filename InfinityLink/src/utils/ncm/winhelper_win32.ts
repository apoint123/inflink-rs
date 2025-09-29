/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-05-01 15:10:10
 * @modify date 2021-05-01 15:10:10
 *
 * @desc native 命名空间 winhelper_win32 相关 api
 */

/**
 * @see {@link:https://g.hz.netease.com/cloudmusic-native/cloudmusic_win32/-/blob/5d521c62b4f4dbbaea41a5cca75a3522e0aa3f6e/orpheus/src/framework/plugin/winhelper/winhelper.cpp#L361}
 */
type IShowWindowAction = "show" | "hide" | "restore" | "minimize" | "maximize";

/**
 * @description 获取窗口的不透明度
 *
 * 注意, 返回值可能会是不精确的浮点数
 */
export async function getWindowOpacity() {
	return legacyNativeCmder.call<number>("winhelper.getWindowOpacity");
}

/**
 * @description 设置窗口的不透明度.
 *
 * 注意, win32 上该方法似乎没有什么实际作用.
 */
export async function setWindowOpacity(opacity: number) {
	if (opacity < 0 || opacity > 1) {
		throw new Error(
			`[winhelper_win32.setWindowOpacity] opacity must be numebr in [0, 1.0], but ${opacity} provided!`,
		);
	}
	return legacyNativeCmder.call<void>("winhelper.setWindowOpacity", opacity);
}

/**
 * @description 获取 window 的信息
 *
 */
async function getWindowInfo(key: "status") {
	return legacyNativeCmder.call<
		typeof key extends "status"
			? {
					/**
					 * @description 窗口
					 */
					status: "maximize" | "restore";
					/**
					 * @description 是否可见
					 */
					visible: boolean;
				}
			: unknown
	>("winhelper.getWindowInfo", key);
}

/**
 * @description 获取窗口状态
 */
export function getWindowStatus() {
	return getWindowInfo("status");
}

/**
 * @description 切换窗口的显示状态
 *
 * @see {kShowWindowAction}
 */
export function showWindow(action: IShowWindowAction = "show") {
	return legacyNativeCmder.call<void>("winhelper.showWindow", action);
}

/**
 * @description 设置数据到剪贴板
 */
export function setClipBoardData(data: ArrayBuffer | string) {
	return legacyNativeCmder.call<void>("winhelper.setClipBoardData", data);
}

/**
 * @description 从剪贴板获取数据
 */
export function getClipBoardData() {
	return legacyNativeCmder.call<string>("winhelper.getClipBoardData");
}

/**
 * @description 设置要用于剪切或复制的文件列表到剪贴板
 */
export function setFilesToClipboard(cmd: "cut" | "copy", fileList: string[]) {
	return legacyNativeCmder.call<void>(
		"winhelper.setFilesToClipboard",
		cmd,
		fileList,
	);
}

type ILaunchWindowOptions = {
	/** @description 打开后是否可见 */
	visible?: boolean;
	/** @description 是否有托盘图标 */
	taskbarButton?: boolean;
	/** @description ? */
	spec_window?: boolean;
	/** @description 是否可以改变大小 */
	resizable?: boolean;
	/** @description 窗口的圆角 px 值, 整数 */
	corner_size?: number;
};

/**
 * @description 在新窗口中打开一个 url
 *
 * 如果打开成功, 会返回 true
 */
export function launchWindow(url: string, opts: ILaunchWindowOptions = {}) {
	const { ...options } = opts || {};
	if (options.visible === undefined) options.visible = false;
	if (options.resizable === undefined) options.resizable = false;
	if (options.spec_window === undefined) options.spec_window = true;
	if (options.taskbarButton === undefined) options.taskbarButton = false;

	return legacyNativeCmder.call<undefined | true>(
		"winhelper.launchWindow",
		url,
		options,
		options,
	);
}

// const DEFAULT_WORKAREA: IWindowRectInfo = {
//     x: 0,
//     y: 0,
//     width: 1366,
//     height: 768,
// }

// function getUrl (url: string, workArea: Partial<IWindowRectInfo>) {
//     const querys = {
//         ...query2object(qs),
//         ...DEFAULT_WORKAREA,
//         ...workArea
//     };

//     const [base, qs = ''] = url.split('?')

//     url = `${base}?${object2query(querys)}`;

//     return url;
// }

type ISetWindowRectConfiguration = Partial<unknown> & {
	/**
	 * @description 是否将窗口拉到最顶层
	 */
	topmost?: boolean;
	/**
	 * @description 是否激活窗口
	 */
	active?: boolean;
};

/**
 * @description 设置窗口的位置参数.
 */
export async function getWindowPosition() {
	return legacyNativeCmder.call<
		Required<Omit<ISetWindowRectConfiguration, "active">>
	>("winhelper.getWindowPosition");
}

/**
 * @description 设置窗口的位置参数.
 */
export async function setWindowPosition(rectInfo: ISetWindowRectConfiguration) {
	return legacyNativeCmder.call<void>("winhelper.setWindowPosition", rectInfo);
}

type INativeWindowType = "mini_player" | "desktop_lyrics";

/**
 * @description 设置某个窗口是否展示, 可指定
 *
 * - 主窗口(默认)
 * - 迷你播放器
 * - 桌面歌词
 *
 * @see {INativeWindowType}
 */
export function setNativeWindowShow({
	windowType,
	visible = true,
}: {
	windowType?: INativeWindowType;
	visible?: boolean;
} = {}) {
	return legacyNativeCmder.call<void>(
		"winhelper.SetNativeWindowShow",
		windowType || undefined,
		visible,
	);
}

/**
 * @description 设置 navigate 窗口的的 rect 信息,
 *
 * 目前只能设置 'mini_player' 的尺寸
 *
 */
export async function setNativeWindowRect(
	options: {
		name: "mini_player";
	} & ISetWindowRectConfiguration,
) {
	return legacyNativeCmder.call<unknown>(
		"winhelper.setNativeWindowRect",
		options,
	);
}

/**
 * @description 获取 navigate 窗口的的 rect 信息,
 *
 * 目前只能获取 'mini_player' 的尺寸
 *
 */
export async function getNativeWindowRect(name: "mini_player") {
	return legacyNativeCmder.call<unknown>("winhelper.getNativeWindowRect", name);
}
