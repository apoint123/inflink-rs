import type { ResolutionSetting } from "../hooks";
import type { CoverSource, SongInfo } from "../types/smtc";
import logger from "./logger";

export class CoverManager {
	private fetchController: AbortController | null = null;
	private fetchGeneration = 0;

	public getCover(
		songInfo: SongInfo,
		resolution: ResolutionSetting,
		onComplete: (result: {
			songInfo: SongInfo;
			cover: CoverSource | null;
		}) => void,
	): void {
		this.fetchController?.abort();
		this.fetchGeneration++;

		const generation = this.fetchGeneration;
		const currentCover = songInfo.cover;

		if (!currentCover || currentCover.type !== "Url") {
			onComplete({ songInfo, cover: currentCover });
			return;
		}

		const thumbnailUrl = this.createImageUrl(currentCover.value, resolution);

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

				const encodeStart = performance.now();
				const dataUri = await this.convertBlobToDataUri(blob);
				const encodeEnd = performance.now();
				logger.debug(
					`封面 Base64 编码用时: ${Math.round(encodeEnd - encodeStart)}ms`,
					"CoverManager",
				);

				const base64Data = dataUri.split(",")[1];
				if (!base64Data) {
					throw new Error("生成的 Data URI 格式无效");
				}

				onComplete({
					songInfo,
					cover: { type: "Base64", value: base64Data },
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

	private createImageUrl(url: string, resolution: ResolutionSetting): string {
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

	private async convertBlobToDataUri(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = (error) => reject(error);
			reader.readAsDataURL(blob);
		});
	}
}
