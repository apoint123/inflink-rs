import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, Rolldown } from "vite";
import { build } from "vite";
import type { BetterNCMPluginManifest, HijackAction } from "@/types/manifest";
import {
	BOOTSTRAP_PORT_PLACEHOLDER,
	CSP_STRIP_HIJACK,
	HIJACK_VERSION_RANGE,
	HMR_PORT,
	MANIFEST_SRC,
	PLUGIN_DIR,
	SRC_DIR,
} from "./constants.ts";
import { buildRust, copyDlls } from "./rust.ts";

/** dev 专用 manifest 中新增的 CSP 移除规则 */
const CSP_STRIP_HIJACKS: Record<string, HijackAction[]> = {
	"orpheus://orpheus/pub/app.html": [CSP_STRIP_HIJACK],
};

/**
 * HMR 引导插件配置选项。
 */
export interface InflinkHmrBootstrapOptions {
	/** 是否跳过 Rust 后端编译 */
	skipRust?: boolean;
}

/**
 * 生成 dev 专用 `manifest.json`：禁用整页刷新并移除 app.html 的 CSP 限制，
 * 仅写入插件目录，不影响仓库内的 manifest。
 */
function writeDevManifest() {
	const manifest = JSON.parse(
		fs.readFileSync(MANIFEST_SRC, "utf-8"),
	) as BetterNCMPluginManifest;
	manifest.noDevReload = true;
	manifest.hijacks = manifest.hijacks ?? {};
	manifest.hijacks[HIJACK_VERSION_RANGE] = {
		...manifest.hijacks[HIJACK_VERSION_RANGE],
		...CSP_STRIP_HIJACKS,
	};
	return writeFile(
		path.join(PLUGIN_DIR, "manifest.json"),
		JSON.stringify(manifest),
	);
}

/**
 * 把 `dev-bootstrap.ts` 单独打包成引导脚本。
 *
 * 必须用独立构建而非当前 dev server 的模块图：引导脚本要在 BetterNCM loader
 * 的同步阶段就执行完，不能等待 dev server 返回模块。
 */
async function buildBootstrapScript() {
	const result = await build({
		configFile: false,
		define: {
			[BOOTSTRAP_PORT_PLACEHOLDER]: JSON.stringify(HMR_PORT),
		},
		build: {
			// 只在内存中产出，不写盘、也不清空 dist
			write: false,
			sourcemap: "inline",
			lib: {
				entry: path.join(SRC_DIR, "dev-bootstrap.ts"),
				formats: ["es"],
			},
		},
	});

	const outputs = Array.isArray(result) ? result : [result];
	const code = outputs
		.filter((item): item is Rolldown.RolldownOutput => "output" in item)
		.flatMap((item) => item.output)
		.find((item): item is Rolldown.OutputChunk => item.type === "chunk")?.code;
	if (!code) {
		throw new Error("引导脚本打包失败：没有可用的输出");
	}
	if (code.includes(BOOTSTRAP_PORT_PLACEHOLDER)) {
		throw new Error("引导脚本打包后仍残留端口占位符");
	}
	return code;
}

/**
 * BetterNCM 开发环境 HMR 引导插件。
 *
 * 在 Vite 开发服务器启动阶段准备运行时环境：
 * 1. 增量编译并复制 Rust debug DLL 到插件目录；
 * 2. 生成 dev 专用 `manifest.json`（禁用整页刷新并移除 CSP 限制）；
 * 3. 打包 `dev-bootstrap.ts` 生成引导脚本 `index.js`，建立与 Vite dev server 的跨源 HMR 连接。
 */
export function inflinkHmrBootstrap(
	options: InflinkHmrBootstrapOptions = {},
): Plugin {
	const { skipRust = false } = options;

	return {
		name: "inflink-hmr-bootstrap",
		apply: "serve",
		async buildStart() {
			await mkdir(PLUGIN_DIR, { recursive: true });

			if (!skipRust) {
				buildRust("debug");
			}
			await copyDlls("debug", PLUGIN_DIR);

			await writeDevManifest();

			const bootstrap = await buildBootstrapScript();
			await writeFile(path.join(PLUGIN_DIR, "index.js"), bootstrap);

			console.log(`🔥 HMR 引导产物已写入 ${PLUGIN_DIR}`);
		},
	};
}
