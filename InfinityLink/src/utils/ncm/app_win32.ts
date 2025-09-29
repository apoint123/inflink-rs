/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-05-01 21:59:11
 * @modify date 2021-05-01 21:59:11
 *
 * @desc native 命名空间 app 相关 api
 */

/**
 * @description 将一行日志打到本地 cloudmusic.log 文件, 前缀类似于
 *
 * `[90680:82112:0501/222541:1031024703:INFO:app.cpp(1081)]`
 */
export async function log(lineContent: string) {
	return legacyNativeCmder.call<void>("app.log", lineContent);
}

/**
 * @description exit 的时候传的附带 cmd
 * @see {@link:https://g.hz.netease.com/cloudmusic-native/cloudmusic_win32/-/blob/30879f3453554705da206d2012c1313d9e3743a5/orpheus/src/framework/plugin/app/app.cpp}
 */
type IExitCmdMap =
	| {
			// restart 时加上 --noallowupdate --webargument=<webargument>
			cmd: "restart";
			webargument?: string;
	  }
	| {
			// exit 时加上 --orpheus-startup=quitrun
			cmd: "quitrun";
	  }
	| {
			// exit 时加上 --orpheus-startup=install
			cmd: "install";
	  }
	| {
			// exit 时加上 --orpheus-startup=clear_user_data_run
			cmd: "clear_user_data_run";
	  }
	| {
			// exit 时加上
			// --orpheus-startup=moverun
			// --movesrc=<from>
			// --movedest=<to>
			// --require=<requiresize>
			// --hidetaskbar
			cmd: "moverun";
			from: string;
			to: string;
			requiresize: number;
	  };

/**
 * @description 退出 app, 会关闭所有打开的窗口, 并退出当前
 *
 * 和 app 命名空间下不同, 该 exit 支持还支持另外两种格式:
 *
 * 1. 传入一个 command, 如果传入了 command, 意味着本次
 * 退出**必然**会触发拉取更新, 会带上 `--orpheus-restart-for-update`
 * 2. 传入 command, from, to, require 参数, 表明这是
 * moverun
 *
 * 如果设置退出时不带参数, 或者带的参数有误, 返回 false; 若带了参数
 * 切参数都传递正确, 则返回 true. 不过因为进程已经退出, 所以这个返回
 * 没什么意义.
 *
 * @see {IExitCmdMap}
 */
export async function exit(cmdMap?: IExitCmdMap) {
	if (!cmdMap) {
		return legacyNativeCmder.call<false>("app.exit");
	}

	if (cmdMap.cmd === "restart") {
		if ("webargument" in cmdMap) {
			return legacyNativeCmder.call<boolean>(
				"app.exit",
				"restart",
				cmdMap.webargument,
			);
		}

		return legacyNativeCmder.call<boolean>("app.exit", "restart");
	}

	if (cmdMap.cmd === "moverun") {
		return legacyNativeCmder.call<boolean>(
			"app.exit",
			"moverun",
			cmdMap.from,
			cmdMap.to,
			cmdMap.requiresize,
		);
	}

	return legacyNativeCmder.call<boolean>("app.exit", cmdMap.cmd);
}

type ILocalConfigMap = {
	setting: `hardware-acceleration`;
	features: `hdpi`;
	Update: `Install`;
	Proxy: ``;
};

type ILocalConfigRoot = keyof ILocalConfigMap;

/**
 * @description
 *
 * '0': falsy
 * '1': truthy
 * '': unset
 */
type INumbericBool = "0" | "1" | "";
/**
 * @description 获取本地配置
 */
export async function getLocalConfig<TK extends ILocalConfigRoot>(
	root: TK,
	sub_key: ILocalConfigMap[TK],
) {
	return legacyNativeCmder.call<INumbericBool>(
		"app.getLocalConfig",
		root,
		sub_key,
	);
}

/**
 * @description 更新本地配置
 */
export async function setLocalConfig<TK extends ILocalConfigRoot>(
	root: ILocalConfigRoot,
	sub_key: ILocalConfigMap[TK],
	value: Exclude<INumbericBool, "">,
) {
	return legacyNativeCmder.call<void>(
		"app.setLocalConfig",
		root,
		sub_key,
		value,
	);
}

/**
 * @description 获取系统版本, 比如
 *
 * `Microsoft-Windows-10-Professional-build-19042-64bit`
 */
export async function osVesion() {
	return legacyNativeCmder.call<string>("app.osVesion");
}

type IFeaturesSwitchMap = {
	/**
	 * @description 开启高分屏适配, 生效需重启 app
	 **/
	hdpi: boolean;
};
/**
 * @description 一些 app 特性的开关, 比如 'hdpi'
 */
export async function featuresSwitch<TK extends keyof IFeaturesSwitchMap>(
	k: TK,
	value: IFeaturesSwitchMap[TK],
) {
	return legacyNativeCmder.call<void>("app.featuresSwitch", {
		[k]: value,
	});
}

/**
 * @description 以 userid 向 host 登录
 *
 * 一般之后要立刻将 webview 中的 browser cookies 同步给 native 端
 */
export async function login(userid: string) {
	return legacyNativeCmder.call<void>("app.login", { userid });
}

type IInitConfigMap = {
	/**
	 * @description 开启高分屏适配, 生效需重启 app
	 **/
	hostcookie: string;
};
/**
 * @description 初始化一些配置, 比如 host 的 cookie 信息
 *
 * 一个典型的应用是, 从 brwoser.getCookies 获取到某个 domain cookie 后,
 * 作为云音乐的 cookie, 提给 native 端
 */
export async function initConfig<TK extends keyof IInitConfigMap>(
	k: TK,
	value: IInitConfigMap[TK],
) {
	return legacyNativeCmder.call<void>("app.initConfig", {
		[k]: value,
	});
}

type IAutoRunnableExe = "cloudmusic";

/**
 * @description 设置云音乐 exe_path 下的某个应用程序开机自动运行
 *
 * 一般来说就是 cloudmusic.exe
 *
 * 原理是写注册表
 */
export async function setAutoRun(name: IAutoRunnableExe = "cloudmusic") {
	return legacyNativeCmder.call<void>("app.setAutoRun", name, "autorun");
}

/**
 * @description 取消云音乐 exe_path 下的某个应用程序开机自动运行
 *
 * 一般来说就是 cloudmusic.exe
 *
 * 原理是删注册表中自动运行 key 中应用程序名对应的指
 */
export async function cancelAutoRun(name: IAutoRunnableExe = "cloudmusic") {
	return legacyNativeCmder.call<void>("app.cancelAutoRun", name);
}

/**
 * @description 查询云音乐 exe_path 下的某个应用程序开机自动运行
 *
 * 一般来说就是 cloudmusic.exe
 *
 * 原理是删注册表中自动运行 key 中应用程序名对应的指
 */
export async function getAutoRunState(name: IAutoRunnableExe = "cloudmusic") {
	return legacyNativeCmder.call<boolean>("app.getAutoRunState", name);
}
