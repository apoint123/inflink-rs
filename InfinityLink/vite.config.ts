import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const buildRustPlugin = (): Plugin => {
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
			buildRust();
		},
		writeBundle: (options) => {
			if (!options.dir) {
				console.error(
					"Vite output directory is not defined. Cannot copy files.",
				);
				return;
			}

			const manifestSrc = path.resolve(__dirname, "manifest.json");
			const manifestDest = path.resolve(options.dir, "manifest.json");
			fs.copyFileSync(manifestSrc, manifestDest);

			const rustSrc = path.resolve(
				__dirname,
				"../smtc_handler/target/release/smtc_handler.dll",
			);

			const rustDest = path.resolve(options.dir, "smtc_handler.dll");
			fs.copyFileSync(rustSrc, rustDest);
		},
	};
};

export default defineConfig(({ mode }) => ({
	plugins: [react(), buildRustPlugin()],
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
