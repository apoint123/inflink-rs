import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";

const buildRustPlugin = (mode: string): Plugin => {
	const buildRust = () => {
		console.log("构建rust程序...");
		execSync("cargo build --release", {
			cwd: path.resolve(__dirname, "../smtc_handler"),
			stdio: "inherit",
		});
	};

	return {
		name: "vite-plugin-build-rust",
		buildStart: () => {
			if (mode !== "development" || !buildRustPlugin.rustBuilt) {
				buildRust();
				buildRustPlugin.rustBuilt = true;
			}
		},
		writeBundle: (options) => {
			if (!options.dir) {
				console.error(
					"Vite output directory is not defined. Cannot copy files.",
				);
				return;
			}
			const outputDir = options.dir;

			const manifestSrc = path.resolve(__dirname, "manifest.json");
			const manifestDest = path.resolve(outputDir, "manifest.json");
			fs.copyFileSync(manifestSrc, manifestDest);

			const rustSrc = path.resolve(
				__dirname,
				"../target/release/smtc_handler.dll",
			);
			const rustDest = path.resolve(outputDir, "smtc_handler.dll");
			fs.copyFileSync(rustSrc, rustDest);

			if (mode === "development") {
				const devPluginDir = "C:/betterncm/plugins_dev/InfLink-rs";

				fs.mkdirSync(devPluginDir, { recursive: true });

				const filesInDist = fs.readdirSync(outputDir);

				for (const file of filesInDist) {
					if (file.endsWith(".dll")) {
						continue;
					}
					const srcPath = path.join(outputDir, file);
					const destPath = path.join(devPluginDir, file);
					fs.copyFileSync(srcPath, destPath);
				}
			}
		},
	};
};
buildRustPlugin.rustBuilt = false;

export default defineConfig(({ mode }) => ({
	plugins: [react(), buildRustPlugin(mode)],
	define: {
		"process.env": {},
		DEBUG: mode === "development",
	},
	build: {
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
}));
