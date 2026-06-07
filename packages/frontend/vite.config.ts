import { execSync } from "node:child_process";
import fs from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import type pkg from "./package.json";

const packageJson: typeof pkg = JSON.parse(
	fs.readFileSync("./package.json", "utf-8"),
);
const APP_VERSION = packageJson.version;

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_DIR = __dirname;
const DIST_DIR = path.join(FRONTEND_DIR, "dist");
const MANIFEST_SRC = path.join(FRONTEND_DIR, "manifest.json");
const DEFAULT_PLUGIN_DIR = "C:/betterncm/plugins_dev/InfLink-rs";
const DEV_PLUGIN_DIR = process.env.BETTERNCM_PLUGIN_PATH || DEFAULT_PLUGIN_DIR;

const args = process.argv.slice(2);
const skipRust = args.includes("--no-rust") || process.env.SKIP_RUST === "1";

function betterNcmBuilder(isDev: boolean, skipRust: boolean): Plugin {
	return {
		name: "betterncm-builder",

		async buildStart() {
			if (skipRust) {
				console.log("⏩ [Rust] 跳过编译");
				return;
			}
			console.log(`🦀 [Rust] 正在编译后端...`);
			const buildProfile = isDev ? "debug" : "release";
			const cargoFlags = isDev ? "" : "--release";

			try {
				console.log(`   -> i686-pc-windows-msvc (${buildProfile})`);
				execSync(`cargo build --target i686-pc-windows-msvc ${cargoFlags}`, {
					cwd: PROJECT_ROOT,
					stdio: "inherit",
				});

				console.log(`   -> x86_64-pc-windows-msvc (${buildProfile})`);
				execSync(`cargo build --target x86_64-pc-windows-msvc ${cargoFlags}`, {
					cwd: PROJECT_ROOT,
					stdio: "inherit",
				});

				console.log("✅ [Rust] 编译完成");
			} catch (e) {
				console.error("❌ [Rust] 编译失败:", e);
				process.exit(1);
			}
		},

		async closeBundle() {
			const buildProfile = isDev ? "debug" : "release";
			const dllSrcX86 = path.join(
				PROJECT_ROOT,
				`target/i686-pc-windows-msvc/${buildProfile}/backend.dll`,
			);
			const dllSrcX64 = path.join(
				PROJECT_ROOT,
				`target/x86_64-pc-windows-msvc/${buildProfile}/backend.dll`,
			);

			const safeCopy = async (src: string, dest: string) => {
				if (!fs.existsSync(src)) return;
				try {
					await cp(src, dest);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					console.warn(`⚠️ 复制失败，跳过: ${path.basename(dest)} (${msg})`);
				}
			};

			await safeCopy(dllSrcX86, path.join(DIST_DIR, "backend.dll"));
			await safeCopy(dllSrcX64, path.join(DIST_DIR, "backend.dll.x64.dll"));
			await safeCopy(MANIFEST_SRC, path.join(DIST_DIR, "manifest.json"));
			await safeCopy(
				path.join(PROJECT_ROOT, "preview.png"),
				path.join(DIST_DIR, "preview.png"),
			);

			if (isDev) {
				console.log(`\n🔄 同步构建产物到插件目录: ${DEV_PLUGIN_DIR}`);
				await mkdir(DEV_PLUGIN_DIR, { recursive: true });
				const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
				for (const entry of entries) {
					const srcPath = path.join(DIST_DIR, entry.name);
					const destPath = path.join(DEV_PLUGIN_DIR, entry.name);
					try {
						await cp(srcPath, destPath, { recursive: true, force: true });
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						console.warn(`⚠️ 同步失败，跳过: ${entry.name} (${msg})`);
					}
				}
			}
		},
	};
}

export default defineConfig(({ mode }) => {
	const isDev = mode === "development";
	const skipRustBuild = skipRust || mode === "frontend-only";

	process.env.NODE_ENV = isDev ? "development" : "production";

	return {
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "src"),
			},
		},
		define: {
			__APP_VERSION__: JSON.stringify(APP_VERSION),
			"process.env.NODE_ENV": JSON.stringify(
				isDev ? "development" : "production",
			),
		},
		build: {
			outDir: "dist",
			emptyOutDir: true,
			minify: !isDev,
			sourcemap: false,
			watch: isDev ? {} : undefined,
			lib: {
				entry: path.resolve(__dirname, "src/index.tsx"),
				name: "InfLinkrs",
				formats: ["iife"],
				fileName: () => "index.js",
			},
		},
		plugins: [betterNcmBuilder(isDev, skipRustBuild), cssInjectedByJsPlugin()],
	};
});
