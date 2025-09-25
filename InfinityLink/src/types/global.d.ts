import type { NCMInjectPlugin, NCMPlugin } from "plugin";

declare global {
	interface Window {
		/** 一个由 C++ 侧设置的访问密钥，以免出现非法调用 */
		BETTERNCM_API_KEY: string;
		BETTERNCM_API_PATH: string;
		BETTERNCM_FILES_PATH: string;
		BETTERNCM_API_PORT: number;

		// biome-ignore lint/suspicious/noExplicitAny: 网易云自带IPC对象，因为量比较大所以不做类型限定了
		channel: any;

		h: typeof import("react").createElement;
		f: typeof import("react").Fragment;
		dom: typeof import("betterncm-api/utils").dom;
		React: typeof import("react");
		ReactDOM: typeof import("react-dom");

		// biome-ignore lint/suspicious/noExplicitAny: 云村自带的应用配置属性，因为量比较大所以不做类型限定了
		APP_CONF: any;

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
}
