import type { PaletteMode } from "@mui/material";
import { useEffect, useState } from "react";
import logger from "../utils/logger";

function getNcmThemeMode(): PaletteMode {
	const v3Theme = localStorage.getItem("currentTheme");
	if (v3Theme) {
		return /^dark/i.test(v3Theme) ? "dark" : "light";
	}

	const v2Theme = localStorage.getItem("NM_SETTING_SKIN");
	if (v2Theme) {
		try {
			const v2ThemeConfig = JSON.parse(v2Theme);
			const selectedTheme = v2ThemeConfig?.selected?.name;
			return selectedTheme === "default" ? "dark" : "light";
		} catch (e) {
			logger.warn("解析 v2 主题设置失败", e);
		}
	}

	return "light";
}

export function useNcmTheme(): PaletteMode {
	const [ncmThemeMode, setNcmThemeMode] = useState(getNcmThemeMode);

	useEffect(() => {
		const handleStorageChange = (event: StorageEvent) => {
			if (
				event.key === "currentTheme" || // v3
				event.key === "NM_SETTING_SKIN" // v2
			) {
				setNcmThemeMode(getNcmThemeMode());
			}
		};

		window.addEventListener("storage", handleStorageChange);
		return () => {
			window.removeEventListener("storage", handleStorageChange);
		};
	}, []);

	return ncmThemeMode;
}
