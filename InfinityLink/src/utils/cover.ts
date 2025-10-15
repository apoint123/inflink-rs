import type { SongInfo } from "../types/smtc";
import logger from "./logger";

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

export class CoverManager {
	private fetchController: AbortController | null = null;
	private fetchGeneration = 0;

	public getCover(
		songInfo: SongInfo,
		onComplete: (result: {
			songInfo: SongInfo;
			dataUri: string | null;
		}) => void,
	): void {
		this.fetchController?.abort();
		this.fetchGeneration++;

		const generation = this.fetchGeneration;
		const thumbnailUrl = this.createImageUrl(songInfo.thumbnailUrl);

		if (!thumbnailUrl) {
			onComplete({ songInfo, dataUri: null });
			return;
		}

		this.fetchController = new AbortController();
		const { signal } = this.fetchController;

		(async () => {
			try {
				const fetchStart = performance.now();
				const response = await fetch(thumbnailUrl, { signal });
				if (!response.ok) {
					throw new Error(`HTTP 错误, 状态码: ${response.status}`);
				}
				const fetchEnd = performance.now();
				logger.debug(
					`[InfLink-rs] 封面获取用时: ${Math.round(fetchEnd - fetchStart)}ms`,
				);

				if (generation !== this.fetchGeneration) return;

				const blob = await response.blob();

				const encodeStart = performance.now();
				const dataUri = await this.convertBlobToDataUri(blob);
				const encodeEnd = performance.now();
				logger.debug(
					`[InfLink-rs] 封面 Base64 编码用时: ${Math.round(encodeEnd - encodeStart)}ms`,
				);

				onComplete({ songInfo, dataUri });
			} catch (e) {
				if ((e as Error).name !== "AbortError") {
					logger.warn(`[InfLink-rs] 获取缓存封面失败: ${(e as Error).message}`);
					if (generation === this.fetchGeneration) {
						onComplete({ songInfo, dataUri: songInfo.thumbnailUrl });
					}
				}
			} finally {
				if (this.fetchController?.signal === signal) {
					this.fetchController = null;
				}
			}
		})();
	}

	private createImageUrl(url: string): string {
		if (!url || !url.startsWith("http")) {
			return url;
		}

		const baseUrl = url.split("?")[0];

		const imageParams = new URLSearchParams({
			enlarge: "1",
			type: "jpeg",
			quality: "90",
			thumbnail: "500y500",
		});

		const processedUrl = `${baseUrl}?imageView&${imageParams.toString()}`;

		return `orpheus://cache/?${processedUrl}`;
	}

	private async convertBlobToDataUri(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = (error) => reject(error);
			reader.readAsDataURL(blob);
		});
	}
}
