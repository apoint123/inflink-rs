import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";

const packageJson = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

const copyAssetsPlugin = (mode: string): Plugin => {
	const targetArch = process.env.TARGET_ARCH || "x64";
	const isX64 = targetArch === "x64";

	console.log(`[Vite] 构建目标: ${targetArch}`);

	const dllSubPath = isX64 ? "x86_64-pc-windows-msvc" : "i686-pc-windows-msvc";
	const manifestFileName = isX64 ? "manifest.v3.json" : "manifest.v2.json";

	return {
		name: "vite-plugin-copy-assets",
		writeBundle: (options) => {
			if (!options.dir) {
				console.error(
					"Vite output directory is not defined. Cannot copy files.",
				);
				return;
			}
			const outputDir = options.dir;
			const projectRoot = path.resolve(__dirname, "..");

			const dllSrc = path.resolve(
				projectRoot,
				`target/${dllSubPath}/release/smtc_handler.dll`,
			);
			const manifestSrc = path.resolve(__dirname, manifestFileName);

			const dllDest = path.resolve(outputDir, "smtc_handler.dll");
			const manifestDest = path.resolve(outputDir, "manifest.json");

			if (fs.existsSync(dllSrc)) {
				fs.copyFileSync(dllSrc, dllDest);
			} else {
				console.error(`[Vite] 找不到dll文件: ${dllSrc}`);
				console.error(`[Vite] 请先运行 'pnpm build:backend'`);
			}

			if (fs.existsSync(manifestSrc)) {
				fs.copyFileSync(manifestSrc, manifestDest);
			} else {
				console.error(`[Vite] 找不到 manifest 文件: ${manifestSrc}`);
			}

			if (mode === "development") {
				const devPluginDir = "C:/betterncm/plugins_dev/InfLink-rs";

				fs.mkdirSync(devPluginDir, { recursive: true });
				const filesInDist = fs
					.readdirSync(outputDir)
					.filter((f) => !f.endsWith(".dll"));
				for (const file of filesInDist) {
					fs.copyFileSync(
						path.join(outputDir, file),
						path.join(devPluginDir, file),
					);
				}
			}
		},
	};
};

export default defineConfig(({ mode }) => {
	const targetArch = process.env.TARGET_ARCH || "x64";
	const outDir = targetArch === "x64" ? "dist/v3" : "dist/v2";

	return {
		plugins: [react(), copyAssetsPlugin(mode)],
		define: {
			"process.env": {},
			DEBUG: mode === "development",
			__APP_VERSION__: JSON.stringify(packageJson.version),
		},
		build: {
			outDir: outDir,
			target: "chrome91",
			sourcemap: mode === "development" ? "inline" : false,
			lib: {
				entry: "src/index.tsx",
				name: "InfinityLink",
				fileName: "index",
				formats: ["iife"],
			},
			rollupOptions: {
				output: {
					entryFileNames: "index.js",
				},
			},
		},
	};
});
