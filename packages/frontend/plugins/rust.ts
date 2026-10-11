import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "./constants.ts";

/** Rust 后端编译配置 */
export type RustProfile = "debug" | "release";

/** 目标架构三元组与产物在插件目录中的文件名 */
export interface RustTarget {
	/** 目标架构三元组，例如 `i686-pc-windows-msvc` */
	triple: string;
	/** 复制到插件目录后的文件名 */
	dllName: string;
}

/** 插件需要支持的全部架构，按此表编译并分发 DLL */
export const RUST_TARGETS: readonly RustTarget[] = [
	{ triple: "i686-pc-windows-msvc", dllName: "backend.dll" },
	{ triple: "x86_64-pc-windows-msvc", dllName: "backend.dll.x64.dll" },
];

/**
 * 获取指定架构与编译配置下的 Rust 后端 DLL 输出文件路径。
 *
 * @param triple - 目标架构三元组（如 `i686-pc-windows-msvc`）
 * @param profile - 编译配置（`debug` 或 `release`）
 */
export const dllSource = (triple: string, profile: RustProfile) =>
	path.join(PROJECT_ROOT, `target/${triple}/${profile}/backend.dll`);

/**
 * 编译 x86 (i686) 与 x64 (x86_64) 双架构的 Rust 原生动态链接库。
 *
 * @param profile - 编译配置（`debug` 或 `release`）
 */
export function buildRust(profile: RustProfile) {
	console.log(`🦀 [Rust] 正在编译后端... (${profile})`);
	try {
		for (const { triple } of RUST_TARGETS) {
			console.log(`   -> ${triple} (${profile})`);
			execFileSync(
				"cargo",
				[
					"build",
					"--target",
					triple,
					...(profile === "release" ? ["--release"] : []),
				],
				{ cwd: PROJECT_ROOT, stdio: "inherit" },
			);
		}
		console.log("✅ [Rust] 编译完成");
	} catch (e) {
		console.error("❌ [Rust] 编译失败:", e);
		process.exit(1);
	}
}

/**
 * 将指定配置的全部 Rust DLL 复制到目标目录。
 *
 * 单个文件复制失败（如 DLL 正被运行中的客户端占用）不会中断流程。
 *
 * @param profile - 来源编译配置（`debug` 或 `release`）
 * @param destDir - 目标目录
 * @returns 因复制失败而跳过的文件名
 */
export async function copyDlls(
	profile: RustProfile,
	destDir: string,
): Promise<string[]> {
	const skipped: string[] = [];
	for (const { triple, dllName } of RUST_TARGETS) {
		const src = dllSource(triple, profile);
		if (!fs.existsSync(src)) {
			console.warn(`⚠️ [DLL] 源不存在，跳过: ${dllName} (${triple})`);
			skipped.push(dllName);
			continue;
		}
		try {
			await cp(src, path.join(destDir, dllName), { force: true });
			console.log(`📋 [DLL] 已复制 ${dllName} (${profile})`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.warn(`⚠️ [DLL] 复制失败，跳过: ${dllName} (${msg})`);
			skipped.push(dllName);
		}
	}
	return skipped;
}
