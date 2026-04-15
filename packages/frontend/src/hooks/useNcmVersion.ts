import { useEffect, useState } from "react";
import logger from "../utils/logger";

export interface NcmVersionInfo {
	major: number;
	minor: number;
	patch: number;
	raw: string;
	adapterVersion: "v3" | "v2";
}

/**
 * 检测当前网易云音乐客户端的版本
 * @returns NcmVersionInfo | null (检测中)
 */
export function useNcmVersion(): NcmVersionInfo | null {
	const [version, setVersion] = useState<NcmVersionInfo | null>(null);

	useEffect(() => {
		try {
			const versionStr = betterncm.ncm.getNCMVersion();
			const parts = versionStr?.split(".").map((p) => parseInt(p, 10)) ?? [];
			const major = parts[0] || 0;
			const minor = parts[1] || 0;
			const patch = parts[2] || 0;

			const adapterVersion = major >= 3 ? "v3" : "v2";

			setVersion({
				major,
				minor,
				patch,
				raw: versionStr,
				adapterVersion,
			});
		} catch (e) {
			logger.error("无法检测网易云音乐版本", "useNcmVersion", e);
			setVersion({
				major: 0,
				minor: 0,
				patch: 0,
				raw: "0.0.0",
				adapterVersion: "v3",
			});
		}
	}, []);

	return version;
}
