/**
 * @fileoverview
 * InfLink-rs 插件的主入口文件
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { patchLocalStorage } from "./utils/";
import logger from "./utils/logger";

const configElement = document.createElement("div");

plugin.onLoad((selfPlugin) => {
	logger.info("插件正在加载...", "onLoad", selfPlugin);

	patchLocalStorage();

	try {
		createRoot(configElement).render(
			<StrictMode>
				<App />
			</StrictMode>,
		);
	} catch (error) {
		logger.error("React 组件渲染失败:", "onLoad", error);
	}
});

plugin.onConfig(() => {
	return configElement;
});
