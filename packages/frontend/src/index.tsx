/**
 * @fileoverview
 * InfLink-rs 插件的主入口文件
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { patchLocalStorage } from "./utils/";
import logger from "./utils/logger";

/**
 * 挂载并初始化插件：把 React 根组件渲染到设置面板容器中。
 *
 * 设置面板容器的创建与 `onConfig` 注册由调用方负责：
 * - 生产环境由 loader 的 load 事件回调创建；
 * - 开发环境（HMR）由引导脚本在入口加载前同步创建并注册。
 *
 * @param selfPlugin - BetterNCM 注入的插件实例
 * @param element - 设置面板容器
 */
export function mount(selfPlugin: typeof plugin, element: HTMLElement) {
	logger.info("插件正在加载...", "mount", selfPlugin);

	patchLocalStorage();

	try {
		createRoot(element).render(
			<StrictMode>
				<App />
			</StrictMode>,
		);
	} catch (error) {
		logger.error("React 组件渲染失败:", "mount", error);
	}
}

// 生产环境监听插件加载事件触发挂载；开发环境由引导脚本直接调用 mount
if (!import.meta.env.DEV) {
	plugin.onLoad((selfPlugin) => {
		const element = document.createElement("div");
		selfPlugin.onConfig(() => element);
		mount(selfPlugin, element);
	});
}
