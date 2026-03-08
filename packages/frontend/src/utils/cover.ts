import type { CoverInfo, SongInfo } from "../types/backend";
import logger from "./logger";

export class CoverManager {
	private fetchController: AbortController | null = null;
	private fetchGeneration = 0;

	public getCover(
		songInfo: SongInfo,
		resolution: string,
		onComplete: (result: {
			songInfo: SongInfo;
			cover: CoverInfo | null;
		}) => void,
	): void {
		this.fetchController?.abort();
		this.fetchGeneration++;

		const generation = this.fetchGeneration;
		const currentCover = songInfo.cover;

		if (!currentCover?.url) {
			onComplete({ songInfo, cover: currentCover });
			return;
		}

		const thumbnailUrl = this.createImageUrl(currentCover.url, resolution);

		if (!thumbnailUrl) {
			onComplete({ songInfo, cover: null });
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
					`封面获取用时: ${Math.round(fetchEnd - fetchStart)}ms`,
					"CoverManager",
				);

				if (generation !== this.fetchGeneration) return;

				const blob = await response.blob();

				onComplete({
					songInfo,
					cover: { blob, url: currentCover.url },
				});
			} catch (e) {
				if ((e as Error).name !== "AbortError") {
					logger.warn(
						`获取缓存封面失败: ${(e as Error).message}`,
						"CoverManager",
					);
					if (generation === this.fetchGeneration) {
						onComplete({ songInfo, cover: currentCover });
					}
				}
			} finally {
				if (this.fetchController?.signal === signal) {
					this.fetchController = null;
				}
			}
		})();
	}

	private createImageUrl(url: string, resolution: string): string {
		if (!url || !url.startsWith("http")) {
			return url;
		}

		const baseUrl = url.split("?")[0];

		const imageParams = new URLSearchParams({
			enlarge: "1",
			type: "jpeg",
			quality: "90",
		});

		if (resolution.toLowerCase() === "max") {
			// 不添加 thumbnail 参数
		} else if (/^\d+$/.test(resolution)) {
			const size = parseInt(resolution, 10);
			imageParams.append("thumbnail", `${size}y${size}`);
		}

		const processedUrl = `${baseUrl}?imageView&${imageParams.toString()}`;

		return `orpheus://cache/?${processedUrl}`;
	}
}
