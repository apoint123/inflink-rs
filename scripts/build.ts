import { execSync } from "node:child_process";
import { watch } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { build, file } from "bun";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const FRONTEND_DIR = path.join(PROJECT_ROOT, "packages/frontend");
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const SRC_ENTRY = path.join(SRC_DIR, "index.tsx");
const DIST_DIR = path.join(FRONTEND_DIR, "dist");
const MANIFEST_SRC = path.join(FRONTEND_DIR, "manifest.json");
const DEFAULT_PLUGIN_DIR = "C:/betterncm/plugins_dev/InfLink-rs";
const DEV_PLUGIN_DIR = process.env.BETTERNCM_PLUGIN_PATH || DEFAULT_PLUGIN_DIR;

const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const isWatch = args.includes("--watch");
const skipRust = args.includes("--no-rust");

const packageJson = await file(path.join(FRONTEND_DIR, "package.json")).json();
const APP_VERSION = packageJson.version;

async function buildRust() {
	if (skipRust) {
		console.log("⏩ [Rust] 跳过编译");
		return;
	}
	console.log("🦀 [Rust] 正在编译后端...");
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
}

async function copyAssets() {
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
		if (await file(src).exists()) await cp(src, dest);
	};

	await safeCopy(dllSrcX86, path.join(DIST_DIR, "backend.dll"));
	await safeCopy(dllSrcX64, path.join(DIST_DIR, "backend.dll.x64.dll"));
	await safeCopy(MANIFEST_SRC, path.join(DIST_DIR, "manifest.json"));
	await safeCopy(
		path.join(PROJECT_ROOT, "preview.png"),
		path.join(DIST_DIR, "preview.png"),
	);
}

async function buildFrontend() {
	const startTime = performance.now();
	try {
		console.log("⚡️ [Frontend] 正在打包代码...");

		const result = await build({
			entrypoints: [SRC_ENTRY],
			outdir: DIST_DIR,
			target: "browser",
			format: "iife",
			minify: !isDev,
			sourcemap: "none",
			features: isDev ? ["DEV"] : [],
			define: {
				"process.env.NODE_ENV": JSON.stringify(
					isDev ? "development" : "production",
				),
				__APP_VERSION__: JSON.stringify(APP_VERSION),
				"import.meta.env": JSON.stringify({
					MODE: isDev ? "development" : "production",
					PROD: !isDev,
					DEV: isDev,
				}),
			},
		});

		if (!result.success) {
			console.error("❌ [Frontend] 构建失败:");
			console.error(result.logs.join("\n"));
			return false;
		}

		if (isDev) {
			await mkdir(DEV_PLUGIN_DIR, { recursive: true });
			await cp(DIST_DIR, DEV_PLUGIN_DIR, { recursive: true, force: true });
		}

		const duration = (performance.now() - startTime).toFixed(2);
		console.log(`✨ [Frontend] 在 ${duration}ms 内构建完毕`);
		return true;
	} catch (error) {
		console.error("❌ [Build] 发生意外错误:", error);
		return false;
	}
}

console.log(
	`\n🚀 [Build] 正在构建 InfLink-rs v${APP_VERSION} (${isDev ? "开发" : "生产"}模式)\n`,
);

await rm(DIST_DIR, { recursive: true, force: true });
await mkdir(DIST_DIR, { recursive: true });

await buildRust();
await copyAssets();

const success = await buildFrontend();
if (!success && !isWatch) {
	process.exit(1);
}

if (isWatch) {
	console.log(`\n👀 [Watch] 正在监视: ${SRC_DIR}`);

	let timer: Timer | null = null;
	let isBuilding = false;

	watch(SRC_DIR, { recursive: true }, (_event, filename) => {
		if (!filename) return;

		if (timer) clearTimeout(timer);
		timer = setTimeout(async () => {
			if (isBuilding) return;
			isBuilding = true;
			console.log(`\n🔄 [Change] 文件变动: ${filename}`);
			await buildFrontend();
			isBuilding = false;
		}, 100);
	});

	setInterval(() => {}, 1 << 30);
}
