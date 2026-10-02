import { execSync } from "node:child_process";
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
			"packages/frontend",
			"package.json",
		);
		const rootPackageJsonPath = path.join(projectRoot, "package.json");
		const manifestPath = path.join(
			projectRoot,
			"packages/frontend",
			"manifest.json",
		);
		const cargoTomlPath = path.join(
			projectRoot,
			"packages/backend",
			"Cargo.toml",
		);
		const cargoLockPath = path.join(projectRoot, "Cargo.lock");

		const sourcePackageJson = JSON.parse(
			fs.readFileSync(sourcePackageJsonPath, "utf-8"),
		);

		const newVersion: string = sourcePackageJson.version;

		if (!newVersion) {
			throw new Error(`无法从 ${sourcePackageJsonPath} 中读取版本号。`);
		}
		console.log(`新版本号: ${newVersion}`);

		const updateJsonVersion = (filePath: string) => {
			const fileContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
			fileContent.version = newVersion;
			fs.writeFileSync(
				filePath,
				`${JSON.stringify(fileContent, null, "\t")}\n`,
			);
			console.log(`已更新 ${path.basename(filePath)}`);
		};

		const updateCargoTomlVersion = (filePath: string) => {
			const fileContent = fs.readFileSync(filePath, "utf-8");
			const versionLine = /^version\s*=\s*".*"$/m;
			if (!versionLine.test(fileContent)) {
				throw new Error(`无法在 ${filePath} 中找到并更新版本号。`);
			}
			const updatedContent = fileContent.replace(
				versionLine,
				`version = "${newVersion}"`,
			);
			if (updatedContent !== fileContent) {
				fs.writeFileSync(filePath, updatedContent);
			}
			console.log(`已更新 ${path.basename(filePath)}`);
		};

		const updateCargoLockVersion = (filePath: string) => {
			try {
				execSync("cargo update -p backend --offline", {
					cwd: projectRoot,
					stdio: "ignore",
				});
				console.log(`已通过 cargo CLI 更新 ${path.basename(filePath)}`);
			} catch {
				const fileContent = fs.readFileSync(filePath, "utf-8");
				const backendBlock =
					/(\[\[package\]\]\r?\nname\s*=\s*"backend"\r?\nversion\s*=\s*)".*"/;
				if (!backendBlock.test(fileContent)) {
					throw new Error(`无法在 ${filePath} 中找到 backend 包的版本号。`);
				}
				const updatedContent = fileContent.replace(
					backendBlock,
					`$1"${newVersion}"`,
				);
				if (updatedContent !== fileContent) {
					fs.writeFileSync(filePath, updatedContent);
				}
				console.log(`已通过文本替换更新 ${path.basename(filePath)}`);
			}
		};

		updateJsonVersion(rootPackageJsonPath);
		updateJsonVersion(manifestPath);
		updateCargoTomlVersion(cargoTomlPath);
		updateCargoLockVersion(cargoLockPath);
	} catch (error) {
		console.error("同步版本号时发生错误:", error);
		process.exit(1);
	}
}

main();
