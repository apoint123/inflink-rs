import type { NcmVersionInfo } from "./useNcmVersion";

export function useVersionWarning(version: NcmVersionInfo | null): boolean {
	if (!version) return false;

	const { major, minor, patch, raw } = version;

	if (major !== 2 && major !== 3) return true;
	if (major === 3 && minor !== 1) return true;

	// 这里的检查比 README.md 要宽松一点，因为 README.md 中的支持的版本是
	// 真的只在那个范围里测试了，但实际上插件应该也能在这个范围之外的一些版本工作
	if (major === 3 && minor === 1 && patch <= 15) return true;

	if (major === 2 && raw !== "2.10.13") return true;

	return false;
}
