import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";

const packageJson = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

const copyAssetsPlugin = (mode: string): Plugin => {
	const copyFile = (src: string, dest: string) => {
		if (!fs.existsSync(src)) {
			console.error(`[Vite] 找不到源文件，无法复制: ${src}`);
			return;
		}
		try {
			fs.copyFileSync(src, dest);
		} catch (error) {
			if (error && typeof error === "object" && "code" in error) {
				if (error.code === "EBUSY" || error.code === "EPERM") {
					console.warn(
						`[Vite] 无法复制 ${path.basename(src)} (文件可能被网易云占用)`,
					);
				} else {
					console.error(`[Vite] 复制 ${path.basename(src)} 时发生错误:`, error);
				}
			} else {
				console.error(
					`[Vite] 复制 ${path.basename(src)} 时发生未知错误:`,
					error,
				);
			}
		}
	};

	return {
		name: "vite-plugin-copy-assets",
		closeBundle: () => {
			const projectRoot = path.resolve(__dirname, "..");
			const outputDir = path.resolve(__dirname, "dist");
			const dllSrcX86 = path.resolve(
				projectRoot,
				"target/i686-pc-windows-msvc/release/smtc_handler.dll",
			);
			const dllSrcX64 = path.resolve(
				projectRoot,
				"target/x86_64-pc-windows-msvc/release/smtc_handler.dll",
			);
			const manifestSrc = path.resolve(__dirname, "manifest.json");
			const previewSrc = path.resolve(projectRoot, "preview.png");

			const dllDestX86 = path.resolve(outputDir, "smtc_handler.dll");
			const dllDestX64 = path.resolve(outputDir, "smtc_handler.dll.x64.dll");
			const manifestDest = path.resolve(outputDir, "manifest.json");
			const previewDest = path.resolve(outputDir, "preview.png");

			fs.mkdirSync(outputDir, { recursive: true });

			copyFile(dllSrcX86, dllDestX86);
			copyFile(dllSrcX64, dllDestX64);
			copyFile(manifestSrc, manifestDest);
			copyFile(previewSrc, previewDest);

			if (mode === "development") {
				const devPluginDir = "C:/betterncm/plugins_dev/InfLink-rs";
				try {
					fs.cpSync(outputDir, devPluginDir, { recursive: true });
				} catch (error) {
					if (error && typeof error === "object" && "code" in error) {
						if (error.code === "EBUSY" || error.code === "EPERM") {
							console.warn("[Vite] 无法同步到开发目录 (文件可能被网易云占用)");
						} else {
							console.error("同步到开发目录时发生错误:", error);
						}
					} else {
						console.error("[Vite] 同步到开发目录时发生未知错误:", error);
					}
				}
			}
		},
	};
};

export default defineConfig(({ mode }) => {
	return {
		plugins: [react(), copyAssetsPlugin(mode)],
		define: {
			"process.env.NODE_ENV": JSON.stringify("development"),
			DEBUG: mode === "development",
			__APP_VERSION__: JSON.stringify(packageJson.version),
		},
		build: {
			outDir: "dist",
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
