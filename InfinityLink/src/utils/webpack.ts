interface WebpackModule {
	exports?: unknown;
}

type WebpackRequire = {
	(id: number | string): unknown;
	c?: Record<string, WebpackModule>; // 模块缓存
};

/**
 * 通过向 Webpack 的模块加载器中推入一个假模块来获取 require 的引用
 *
 * @returns Webpack 的 require 函数
 */
export async function getWebpackRequire(): Promise<WebpackRequire> {
	return new Promise((resolve, reject) => {
		const id = `__inflinkrs_${Date.now()}`;
		const webpackGlobal = window.webpackJsonp;
		if (!webpackGlobal) {
			return reject(new Error("找不到全局变量 webpackJsonp"));
		}
		const dummyModule = {
			[id]: (_m: unknown, _e: unknown, r: WebpackRequire) => resolve(r),
		};

		if (webpackGlobal[0] && Array.isArray(webpackGlobal[0])) {
			// webpack v4
			webpackGlobal.push([[id], dummyModule, [[id]]]);
		} else {
			// webpack v5
			webpackGlobal.push([[id], dummyModule]);
		}
	});
}

/**
 * 在 Webpack 的模块缓存中搜索符合条件的模块
 *
 * @param requireInstance Webpack 的 require 函数实例
 * @param filter 一个返回布尔值的函数，用于判断模块是否符合条件
 * @returns 第一个符合条件的模块，如果未找到则返回 null
 */
export function findModule<T>(
	requireInstance: WebpackRequire,
	filter: (exports: unknown) => exports is T,
): T | null {
	if (!requireInstance.c) {
		return null;
	}

	for (const id in requireInstance.c) {
		const mod = requireInstance.c[id];
		if (mod?.exports) {
			const rawExports = mod.exports;
			const exportsToTest =
				(rawExports as { default?: unknown })?.default ?? rawExports;

			if (filter(exportsToTest)) {
				return exportsToTest as T;
			}
		}
	}
	return null;
}
