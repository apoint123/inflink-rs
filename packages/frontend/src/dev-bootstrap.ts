/**
 * @fileoverview HMR 引导脚本
 *
 * 由 inflinkHmrBootstrap 打包生成并写入插件目录，作为 BetterNCM loader 执行入口。
 *
 * 时序要求：
 * BetterNCM 的插件管理器在挂载时会立即求值并缓存插件是否具备设置面板元素，
 * 为避免拉取入口模块用时过长导致被判定为没有设置面板，需要在首个 yield
 * 前同步创建容器并注册 `onConfig`，入口模块在后台异步拉取并挂载。
 */

const devServerPort = __INFLINK_HMR_PORT__;
const base = `http://localhost:${devServerPort}`;
const configElement = document.createElement("div");
plugin.onConfig(() => configElement);

import(`${base}/@vite/client`)
	.then(() => import(`${base}/@react-refresh`))
	.then((refresh) => {
		refresh.default.injectIntoGlobalHook(window);
		window.$RefreshReg$ = () => {};
		window.$RefreshSig$ = () => (type) => type;
		return import(`${base}/src/index.tsx`) as Promise<typeof import("./index")>;
	})
	.then((entry) => {
		entry.mount(plugin, configElement);
	})
	.catch((e) => {
		console.error("[InfLink HMR] dev 模块加载失败:", e);
	});
