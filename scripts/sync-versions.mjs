// @ts-check

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function main() {
	try {
		const projectRoot = path.resolve(__dirname, "..");
		const sourcePackageJsonPath = path.join(
			projectRoot,
			"InfinityLink",
			"package.json",
		);
		const rootPackageJsonPath = path.join(projectRoot, "package.json");
		const manifestPath = path.join(
			projectRoot,
			"InfinityLink",
			"manifest.json",
		);
		const cargoTomlPath = path.join(projectRoot, "smtc_handler", "Cargo.toml");

		const sourcePackageJson = JSON.parse(
			fs.readFileSync(sourcePackageJsonPath, "utf-8"),
		);

		/** @type {string} */
		const newVersion = sourcePackageJson.version;

		if (!newVersion) {
			throw new Error(`无法从 ${sourcePackageJsonPath} 中读取版本号。`);
		}
		console.log(`新版本号: ${newVersion}`);

		const updateJsonVersion = (/** @type {string} */ filePath) => {
			const fileContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			fileContent.version = newVersion;
			fs.writeFileSync(
				filePath,
				`${JSON.stringify(fileContent, null, "\t")}\n`,
			);
			console.log(`已更新 ${path.basename(filePath)}`);
		};

		const updateCargoTomlVersion = (/** @type {string} */ filePath) => {
			const fileContent = fs.readFileSync(filePath, "utf-8");
			const updatedContent = fileContent.replace(
				/^version\s*=\s*".*"$/m,
				`version = "${newVersion}"`,
			);
			if (updatedContent === fileContent) {
				throw new Error(`无法在 ${filePath} 中找到并更新版本号。`);
			}
			fs.writeFileSync(filePath, updatedContent);
			console.log(`已更新 ${path.basename(filePath)}`);
		};

		updateJsonVersion(rootPackageJsonPath);
		updateJsonVersion(manifestPath);
		updateCargoTomlVersion(cargoTomlPath);
	} catch (error) {
		console.error("同步版本号时发生错误:", error);
		process.exit(1);
	}
}

main();
