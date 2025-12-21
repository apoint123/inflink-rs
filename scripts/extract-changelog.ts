import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const changelogPath = join(process.cwd(), "packages/frontend/CHANGELOG.md");
const outputPath = join(process.cwd(), "RELEASE_NOTES.md");

try {
	const content = readFileSync(changelogPath, "utf-8");

	const regex = /##\s+([^\n]+)\n([\s\S]*?)(?=\n##\s|$)/;

	const match = content.match(regex);

	if (!match) {
		console.warn("⚠️ 未能在 CHANGELOG.md 中找到版本条目，将使用默认文本。");
		writeFileSync(
			outputPath,
			"查看详细更新日志：[CHANGELOG.md](https://github.com/apoint123/InfLink-rs/blob/main/packages/frontend/CHANGELOG.md)",
		);
		process.exit(0);
	}

	const version = match[1].trim();
	let body = match[2].trim();

	console.log(`✅ 成功提取版本 v${version} 的更新日志`);

	body += `\n\n查看完整更新日志：[CHANGELOG.md](https://github.com/apoint123/InfLink-rs/blob/main/packages/frontend/CHANGELOG.md)`;

	writeFileSync(outputPath, body);
} catch (error) {
	console.error("❌ 读取或处理 CHANGELOG.md 时发生错误:", error);
	process.exit(1);
}
