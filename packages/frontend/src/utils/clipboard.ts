export async function copyTextToClipboard(text: string): Promise<boolean> {
	if (!text) return false;

	try {
		await Promise.resolve(
			window.legacyNativeCmder.call<void>("winhelper.setClipBoardData", text),
		);
		return true;
	} catch (e) {
		console.error("复制到剪贴板失败", e);
		return false;
	}
}
