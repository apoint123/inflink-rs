import type { NCMInjectPlugin, NCMPlugin } from "plugin";

declare global {
	interface Window {
		/** 一个由 C++ 侧设置的访问密钥，以免出现非法调用 */
		BETTERNCM_API_KEY: string;
		BETTERNCM_API_PATH: string;
		BETTERNCM_FILES_PATH: string;
		BETTERNCM_API_PORT: number;

		/** 与原生代码交互的IPC通道 */
		channel: NCMChannel;

		h: typeof import("react").createElement;
		f: typeof import("react").Fragment;
		dom: typeof import("betterncm-api/utils").dom;
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

		legacyNativeCmder: OrpheusCommand;
	}

	const BETTERNCM_API_KEY: Window["BETTERNCM_API_KEY"];
	const BETTERNCM_API_PATH: Window["BETTERNCM_API_PATH"];
	const BETTERNCM_FILES_PATH: Window["BETTERNCM_FILES_PATH"];
	const BETTERNCM_API_PORT: Window["BETTERNCM_API_PORT"];
	const channel: Window["channel"];
	const h: Window["h"];
	const f: Window["f"];
	const dom: Window["dom"];
	const React: Window["React"];
	const ReactDOM: Window["ReactDOM"];
	const APP_CONF: Window["APP_CONF"];
	const betterncm: Window["betterncm"];
	const betterncm_native: Window["betterncm_native"];
	const plugin: Window["plugin"];
	const legacyNativeCmder: OrpheusCommand;

	const __APP_VERSION__: string;
	const DEBUG: boolean;
}

/**
 * 和网易云音乐原生代码交互的命令
 */
export interface OrpheusCommand {
	// biome-ignore lint/suspicious/noExplicitAny: 内部实现
	_envAdapter: any;
	_isProduction: boolean;

	/**
	 * 调用一个原生命令
	 * @param command 命令名 (e.g., "app.getVersion")
	 * @param args 传递给命令的参数
	 * @returns  命令执行结果的 Promise
	 */
	call<T = unknown>(command: string, ...args: unknown[]): Promise<T>;

	createPromiseFromOrpheusEvent<T = unknown>(
		eventName: `${string}.on${string}`,
		options?: {
			timeout?: number;
			filter_result?: (ctx: unknown, results: T) => boolean;
		},
	): Promise<T>;

	/**
	 * 直接调用原生方法，并返回 Promise
	 * @param method 函数名 (e.g., "serialKey")
	 * @param args 传递给函数的参数
	 */
	do(method: keyof NcmChannel, ...args: unknown[]): Promise<unknown>;

	/**
	 * 覆盖注册一个事件监听器
	 */
	overwriteRegisterCall(
		name: string,
		prefix: string,
		callback?: (...args: string[]) => void,
	): boolean;

	/**
	 * 追加注册一个事件监听器
	 */
	appendRegisterCall(
		name: string,
		prefix: string,
		callback?: (...args: string[]) => void,
	): boolean;

	/**
	 * 如果监听器为空，则注册
	 */
	fillRegisterCallIfEmpty(
		name: string,
		prefix: string,
		callback?: (...args: string[]) => void,
	): boolean;

	/**
	 * 移除一个事件监听器
	 */
	removeRegisterCall(
		name: string,
		prefix: string,
		cb: (...args: string[]) => void,
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
	createPromiseFromNativeRegisterCall<T = unknown>(
		/** @description registerCall <ns> 命名空间下的 cmd */
		name: string,
		/** @description registerCall <ns> 命名空间 */
		ns: string,
		{
			timeout = 60000,
			filter_result,
			filter_context = null,
		}: {
			/** @description 超时时间 ms 值, 默认 60s, 若该值 <= 0, 则表示永不超时 */
			timeout?: number;
			/**
			 * @description 过滤 registerCall 的结果, 当该选项提供时,
			 * 则当 `filter_result(results)` 不为 false 时就 resolve 结果
			 **/
			filter_result?: (ctx: unknown, results: T) => boolean;
			/** @description filter_result 执行时的 ctx 值, 默认为 null */
			filter_context?: unknown;
		} = {},
	): Promise<T>;
}

export interface NCMChannel {
	/**
	 * 从 JS 端向原生端发起一个异步调用，请求执行指定的方法
	 */
	call: <T = void>(method: string, ...args: unknown[]) => Promise<T>;
	/**
	 * 在 JS 端注册一个回调函数，用于响应从原生端发起的调用
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
