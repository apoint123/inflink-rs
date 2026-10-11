import fs from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import {
	DIST_DIR,
	MANIFEST_SRC,
	PLUGIN_DIR,
	PROJECT_ROOT,
} from "./constants.ts";
import { buildRust, copyDlls } from "./rust.ts";

/**
 * BetterNCM 构建插件配置选项。
 */
export interface BetterNcmBuilderOptions {
	/** 是否跳过 Rust 后端编译 */
	skipRust?: boolean;
}

/**
 * 若源文件存在则复制，失败只警告不中断。
 */
async function copyIfExists(src: string, dest: string) {
	if (!fs.existsSync(src)) return;
	try {
		await cp(src, dest);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.warn(`⚠️ 复制失败，跳过: ${path.basename(dest)} (${msg})`);
	}
}

/**
 * BetterNCM 生产构建与产物分发插件。
 *
 * 1. 构建开始时编译 Rust release DLL；
 * 2. 打包完成后把 DLL、manifest 与预览图补进 `dist`（发布产物的完整内容）；
 * 3. 将 `dist` 全量同步至本地 BetterNCM 插件目录（覆盖此前的 dev 引导产物）。
 */
export function betterNcmBuilder(
	options: BetterNcmBuilderOptions = {},
): Plugin {
	const { skipRust = false } = options;

	return {
		name: "betterncm-builder",

		async buildStart() {
			if (skipRust) {
				console.log("⏩ [Rust] 跳过编译");
				return;
			}
			buildRust("release");
		},

		async closeBundle() {
			await copyDlls("release", DIST_DIR);
			await copyIfExists(MANIFEST_SRC, path.join(DIST_DIR, "manifest.json"));
			await copyIfExists(
				path.join(PROJECT_ROOT, "preview.png"),
				path.join(DIST_DIR, "preview.png"),
			);

			console.log(`\n🔄 同步构建产物到插件目录: ${PLUGIN_DIR}`);
			await mkdir(PLUGIN_DIR, { recursive: true });

			const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
			for (const entry of entries) {
				const srcPath = path.join(DIST_DIR, entry.name);
				const destPath = path.join(PLUGIN_DIR, entry.name);
				try {
					await cp(srcPath, destPath, { recursive: true, force: true });
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					console.warn(`⚠️ 同步失败，跳过: ${entry.name} (${msg})`);
				}
			}
		},
	};
}
