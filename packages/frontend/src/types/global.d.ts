import type { NCMInjectPlugin, NCMPlugin } from "plugin";
import type { Store } from "redux";
import type { IInfLinkApi } from "./api";
import type { v3 } from "./ncm";

declare global {
	interface Window {
		/** 一个由 C++ 侧设置的访问密钥，以免出现非法调用 */
		BETTERNCM_API_KEY: string;
		BETTERNCM_API_PATH: string;
		BETTERNCM_FILES_PATH: string;
		BETTERNCM_API_PORT: number;

		/**
		 * @description
		 * 与原生代码交互的IPC通道
		 *
		 * **仅**在Windows上可用
		 *
		 * 强烈不推荐使用此接口，因为它实际上就是 legacyNativeCmder 的底层实现，
		 * 非常低级，并且其 `registerCall` 实现会覆盖掉所有之前的监听器，
		 * 通常会导致其它问题
		 *
		 * @see 请优先使用 {@link legacyNativeCmder}
		 */
		channel: NCMChannel;

		h: typeof import("react").createElement;
		f: typeof import("react").Fragment;
		dom: typeof import("betterncm-api/utils").utils.dom;
		React: typeof import("react");
		ReactDOM: typeof import("react-dom");

		/** 应用配置对象 */
		APP_CONF: NCMAppConfig;

		betterncm: typeof import("betterncm-api/index").default;

		betterncm_native: {
			fs: {
				watchDirectory(
					watchDirPath: string,
					callback: (dirPath: string, filename: string) => void,
				): void;
				readFileText(filePath: string): string;
				readDir(filePath: string): string[];
				exists(filePath: string): boolean;
			};
			app: {
				version(): string;
				reloadIgnoreCache(): void;
				restart(): void;
			};
			native_plugin: {
				getRegisteredAPIs: () => string[];
				call: <T = unknown>(identifier: string, args?: unknown[]) => T;
			};
		};

		plugin: NCMInjectPlugin;

		loadedPlugins: { [pluginId: string]: NCMPlugin };

		loadFailedErrors: [string, Error][];

		/**
		 * @description
		 * 暴露在全局的 `OrpheusCommand` 实例，为各个不同平台的客户端
		 * 与原生代码交互提供了一个统一的 API 封装层。
		 *
		 * @warn 在 v3 客户端上请优先使用内部 Bridge 实例
		 *
		 * v3 的 UI 组件（如 AudioPlayer）使用的是一个独立的内部实例。
		 * 直接使用此全局实例会与网易云内部的实例冲突，导致意外的 Bug
		 *
		 * 建议通过 Webpack 模块查找内部实例（目前观察到其与 AudioPlayer 在同一模块下，名为 `Bridge`）
		 */
		legacyNativeCmder: OrpheusCommand;

		webpackJsonp?: unknown[];

		/**
		 * 调试用的 redux store
		 */
		infstore?: Store;

		/**
		 * 调试用的 v3 内部存储模块
		 */
		infStorage?: v3.NcmStorageModule;

		/**
		 * 可以给其它插件用的接口
		 */
		InfLinkApi?: IInfLinkApi;
	}

	const BETTERNCM_API_KEY: Window["BETTERNCM_API_KEY"];
	const BETTERNCM_API_PATH: Window["BETTERNCM_API_PATH"];
	const BETTERNCM_FILES_PATH: Window["BETTERNCM_FILES_PATH"];
	const BETTERNCM_API_PORT: Window["BETTERNCM_API_PORT"];

	/**
	 * @see {@link window.channel}
	 */
	const channel: Window["channel"];

	/**
	 * @see {@link window.legacyNativeCmder}
	 */
	const legacyNativeCmder: OrpheusCommand;

	const h: Window["h"];
	const f: Window["f"];
	const dom: Window["dom"];
	const APP_CONF: Window["APP_CONF"];
	const betterncm: Window["betterncm"];
	const betterncm_native: Window["betterncm_native"];
	const plugin: Window["plugin"];

	const __APP_VERSION__: string;
	const DEBUG: boolean;
}

/**
 * 和网易云音乐原生代码交互的命令
 */
export interface OrpheusCommand {
	/**
	 * legacyNativeCmder 的核心逻辑，用来适配 Windows 的 CEF 和 Macos 的 WKWebView,
	 * 同时还负责实现 registerCall、removeRegisterCall 等核心逻辑
	 *
	 * 通常不应该直接使用它，应该使用上层的 OrpheusCommand
	 */
	_envAdapter: unknown;
	_isProduction: boolean;

	/**
	 * 调用一个原生命令
	 * @param command 命令名 (e.g., "app.getVersion")
	 * @param args 传递给命令的参数
	 * @returns 命令执行结果的 Promise。
	 *
	 * @description
	 * Promise resolve 的值基于原生回调的参数：
	 * - 如果回调无参数，resolve `undefined`。
	 * - 如果回调有单个参数，resolve 该参数值。
	 * - 如果回调有多个参数，resolve 一个包含所有参数的数组。
	 */
	call<T = unknown>(command: string, ...args: unknown[]): Promise<T>;

	createPromiseFromOrpheusEvent<T extends unknown[] = unknown[]>(
		eventName: `${string}.on${string}`,
		options?: {
			timeout?: number;
			filter_result?: (ctx: unknown, results: T) => boolean;
			filter_context?: unknown;
		},
	): Promise<T>;

	/**
	 * 直接调用底层 channel 上的方法，或在 WKWebView 上模拟此行为。
	 * 这是一个底层方法，返回值依赖于具体环境和方法。
	 *
	 * @param method 函数名 (e.g., "serialKey")
	 * @param args 传递给函数的参数
	 * @returns 一个 Promise，其结果依赖于底层实现 (可能是字符串、null 或其他类型)
	 */
	do(method: keyof NCMChannel, ...args: unknown[]): Promise<unknown>;

	/**
	 * 覆盖注册一个事件监听器
	 */
	overwriteRegisterCall(
		name: string,
		prefix: string,
		callback?: (...args: unknown[]) => void,
	): boolean;

	/**
	 * 追加注册一个事件监听器
	 */
	appendRegisterCall(
		name: string,
		prefix: string,
		callback?: (...args: unknown[]) => void,
	): boolean;

	/**
	 * 如果监听器为空，则注册
	 */
	fillRegisterCallIfEmpty(
		name: string,
		prefix: string,
		callback?: (...args: unknown[]) => void,
	): boolean;

	/**
	 * 移除一个事件监听器
	 */
	removeRegisterCall(
		name: string,
		prefix: string,
		cb: (...args: unknown[]) => void,
	): void;

	/**
	 * 清空某个事件的所有监听器
	 */
	clearRegisterCall(name: string, prefix: string): void;

	/**
	 * 手动触发一个已注册的事件
	 */
	triggerRegisterCall(name: string, prefix: string, ...args: unknown[]): void;

	/**
	 * @description 添加一个 registerCall, 并以其返回结果参数的 tuple 为 resolved value 返回 Promise
	 *
	 * @warn 注意, 该方法并不可靠
	 */
	createPromiseFromNativeRegisterCall<T extends unknown[] = unknown[]>(
		/** @description registerCall <ns> 命名空间下的 cmd */
		name: string,
		/** @description registerCall <ns> 命名空间 */
		ns: string,
		/**
		 * @description 一个包含可选参数的对象
		 */
		options?: {
			/** @description 超时时间 ms 值, 默认 60s, 若该值 <= 0, 则表示永不超时 */
			timeout?: number;
			/**
			 * @description 过滤 registerCall 的结果, 当该选项提供时,
			 * 则当 `filter_result(results)` 不为 false 时就 resolve 结果
			 **/
			filter_result?: (ctx: unknown, results: T) => boolean;
			/** @description filter_result 执行时的 ctx 值, 默认为 null */
			filter_context?: unknown;
		},
	): Promise<T>;
}

/**
 * @description
 * Windows (CEF) 环境下，WebView 与原生端进行双向通信的机制
 *
 * @warning
 * 不推荐直接使用。
 * 这是一个平台相关的底层 API。直接使用它会使你的代码与 Windows 平台绑定
 * (虽然 betterncm 只有 Windows 版本)，并且需要手动处理回调函数，容易出错。
 *
 * @see {OrpheusCommand} - 推荐使用的替代品。
 */
export interface NCMChannel {
	/**
	 * 从 JS 端向原生端发起一个异步调用，请求执行指定的方法。
	 *
	 * 这是一个底层的、基于回调的函数。
	 *
	 * @param method 要调用的方法名
	 * @param callback 调用完成后执行的回调函数
	 * @param params 传递给原生方法的参数数组
	 *
	 * @warn
	 * 建议使用 `legacyNativeCmder.call`，它提供了更现代的 Promise 封装。
	 */
	call(
		method: string,
		callback: (...args: unknown[]) => void,
		params: unknown[],
	): void;

	/**
	 * 在 JS 端注册一个回调函数，用于响应从原生端发起的调用
	 *
	 * @warn
	 * 请使用 `legacyNativeCmder.appendRegisterCall`, registerCall会覆盖所有已有的监听器,
	 * 且会与 legacyNativeCmder 自己维护的回调函数组冲突，通常会导致 UI 或其它组件的问题
	 */
	registerCall(method: string, handler: (...args: unknown[]) => void): void;
	viewCall: (name: unknown) => unknown;
	encodeAnonymousId: (id: unknown) => Promise<unknown>;
	encodeAnonymousId2: (id: unknown) => Promise<unknown>;
	encryptId: (id: unknown) => Promise<unknown>;

	/**
	 * 序列化并加密 API 请求。
	 * @param endpoint API 路径 (e.g., "/api/w/v1/user/bindings/...")
	 * @param payload 请求负载，一个可以被 JSON 化的对象。
	 * @returns 加密后的请求体字符串。
	 */
	serialData: (
		endpoint: string,
		payload: Record<string, unknown>,
	) => Promise<string>;
	serialData2: (
		endpoint: string,
		payload: Record<string, unknown>,
	) => Promise<string>;
	deSerialData: (data: unknown) => Promise<unknown>;

	/**
	 * 为一个 API 请求参数字符串创建一个缓存键
	 *
	 * 猜测用来缓存请求
	 *
	 * @param queryString - 一个由 API 请求参数经过排序和 URL 编码后生成的字符串
	 * @returns 一个像 Base64 的字符串
	 */
	serialKey: (queryString: string) => Promise<string>;

	/**
	 * 数据加密函数，根据输入类型使用不同的加密模式
	 *
	 * 用来把数据加密保存到浏览器的 localStorage 或者本地文件等
	 *
	 * @overload
	 * @param payload - 需要加密的结构化数据 (JSON 对象)
	 * @returns 一个十六进制格式的加密字符串
	 *
	 * @overload
	 * @param id - 需要加密的简单标识符
	 * @returns 一个像 Base64 的字符串
	 */
	enData(payload: Record<string, unknown>): Promise<string>;
	enData(id: string | number): Promise<string>;

	/**
	 * enData 的逆操作
	 */
	deData: (data: unknown) => Promise<unknown>;
	oldLocalStorageData: (...args: unknown[]) => Promise<unknown>;
}

export interface CloudCapacityPayInfo {
	payUrl: string;
	payMsg: string;
	action: number;
}

export interface HotkeyConfig {
	name: string;
	code: number[];
	gcode: number[];
	notconflict: boolean;
	gnotconflict: boolean;
	errcod: number;
	gerrcod: number;
}

export interface AppUrls {
	refer: string;
	lyric: string;
	discern: string;
	statis: string;
	fixdiscern: string;
	fixdiscern_uri: string;
	discern_uri: string;
	e_url: string;
	e_batch_url: string;
	hostgroup1: string[];
	hostgroup2: string[];
	hostgroup3: string[];
	hostgroup4: string[];
	mam: string;
	nsinfo: string;
	dawn: string;
	monitor: string;
}

export interface DeviceInfo {
	app_platform: string;
	computername: string;
	cpu: string;
	cpu_cores: number;
	cpu_cores_logic: number;
	cpu_cur_mhz: number;
	cpu_max_mhz: number;
	devicename: string;
	model: string;
	ram: string;
}

export interface NCMAppConfig {
	windowUUID: string;
	domain: string;
	apiDomain: string;
	useHttps: boolean;
	auto_use_https: boolean;
	encryptResponse: boolean;
	deviceId: string;
	os: string;
	clientSign: string;
	appver: string;
	osver: string;
	thumbnailTheme: string;
	channel: string;
	packageVersion: string;
	allowSharePrivateCloud: boolean;
	maxPrivateCloudUploadSize: number;
	cloudCapacityPayInfo: CloudCapacityPayInfo;
	uploadDomain: string;
	appkey: Record<string, string>;
	key: Record<string, string>;
	invalidCode: number[][];
	hotkey: HotkeyConfig[];
	polling_interval_message: number;
	polling_interval_normal: number;
	curStartChannel: string;
	logLevel: string;
	webRoot: string;
	console: boolean;
	isMainWindow: boolean;
	encrypt: boolean;
	urls: AppUrls;
	deviceInfo: DeviceInfo;
}
