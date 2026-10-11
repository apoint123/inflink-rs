import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import pkg from "./package.json" with { type: "json" };
import {
	betterNcmBuilder,
	HMR_PORT,
	inflinkHmrBootstrap,
	SRC_DIR,
} from "./plugins/index.ts";

const packageJson: typeof pkg = JSON.parse(
	fs.readFileSync("./package.json", "utf-8"),
);
const APP_VERSION = packageJson.version;

const args = process.argv.slice(2);
const skipRust = args.includes("--no-rust") || process.env.SKIP_RUST === "1";

export default defineConfig(({ command, mode }) => {
	const isHmrServer = command === "serve";
	const skipRustBuild = skipRust || mode === "frontend-only";

	process.env.NODE_ENV = isHmrServer ? "development" : "production";

	/** 开发与生产环境通用的共享配置 */
	const shared = {
		resolve: {
			alias: {
				"@": SRC_DIR,
			},
		},
		define: {
			__APP_VERSION__: JSON.stringify(APP_VERSION),
			"process.env.NODE_ENV": JSON.stringify(
				isHmrServer ? "development" : "production",
			),
		},
	};

	// 开发模式：启动 Vite dev server 并注入 BetterNCM HMR 引导产物
	if (isHmrServer) {
		return {
			...shared,
			plugins: [react(), inflinkHmrBootstrap({ skipRust })],
			server: {
				host: "localhost",
				port: HMR_PORT,
				strictPort: true,
				cors: {
					origin: true,
				},
			},
		};
	}

	// 生产模式：编译 IIFE 库产物并由 betterNcmBuilder 分发至插件目录
	return {
		...shared,
		build: {
			outDir: "dist",
			emptyOutDir: true,
			minify: true,
			sourcemap: false,
			rolldownOptions: {
				onwarn(warning, defaultHandler) {
					if (
						warning.code === "MODULE_LEVEL_DIRECTIVE" &&
						warning.message.includes("use client")
					) {
						return;
					}
					defaultHandler(warning);
				},
			},
			lib: {
				entry: path.join(SRC_DIR, "index.tsx"),
				name: "InfLinkrs",
				formats: ["iife"],
				fileName: () => "index.js",
			},
		},
		plugins: [
			betterNcmBuilder({ skipRust: skipRustBuild }),
			cssInjectedByJsPlugin(),
		],
	};
});
