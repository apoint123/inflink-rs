export function resizeImageUrl(
	url: string | undefined | null,
	size = 500,
): string {
	if (!url || typeof url !== "string") {
		return "";
	}
	if (url.includes("?param=")) {
		return url;
	}
	return `${url}?param=${size}y${size}`;
}
