import type { PaletteMode } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import type { ControlMessage } from "./types/smtc";
import logger from "./utils/logger";
import type { BaseProvider } from "./versions/provider";

export function useLocalStorage<T>(
	key: string,
	initialValue: T,
	parse: (string: string) => T = JSON.parse,
	stringify: (value: T) => string = JSON.stringify,
): [T, (value: T | ((prevValue: T) => T)) => void] {
	const [storedValue, setStoredValue] = useState(() => {
		try {
			const item = window.localStorage.getItem(key);
			return item ? parse(item) : initialValue;
		} catch (error) {
			logger.error(error);
			return initialValue;
		}
	});

	const setValue = (value: T | ((prevValue: T) => T)) => {
		try {
			const valueToStore =
				value instanceof Function ? value(storedValue) : value;
			setStoredValue(valueToStore);
			window.localStorage.setItem(key, stringify(valueToStore));
		} catch (error) {
			logger.error(error);
		}
	};

	return [storedValue, setValue];
}

type NcmVersion = "v3" | "v2" | "unsupported";

/**
 * 检测当前网易云音乐客户端的版本
 * @returns 'v3', 'unsupported', 或 null (检测中)
 */
export function useNcmVersion(): NcmVersion | null {
	const [version, setVersion] = useState<NcmVersion | null>(null);

	useEffect(() => {
		try {
			const versionStr = betterncm.ncm.getNCMVersion();
			const majorVersion = parseInt(versionStr.split(".")[0], 10);

			if (majorVersion >= 3) {
				setVersion("v3");
			} else if (majorVersion === 2) {
				setVersion("v2");
			} else {
				logger.warn(`不支持的网易云音乐版本: ${majorVersion}`);
				setVersion("unsupported");
			}
		} catch (e) {
			logger.error("[InfLink-rs] 无法检测网易云音乐版本", e);
			setVersion("unsupported");
		}
	}, []);

	return version;
}

export function useInfoProvider(
	version: NcmVersion | null,
): BaseProvider | null {
	const providerRef = useRef<BaseProvider | null>(null);
	const [isReady, setIsReady] = useState(false);

	useEffect(() => {
		const initializeProvider = async () => {
			if (!version || version === "unsupported") {
				providerRef.current = null;
				setIsReady(true);
				return;
			}

			let providerInstance: BaseProvider | null = null;
			try {
				switch (version) {
					case "v3": {
						const { default: ProviderV3 } = await import("./versions/v3");
						providerInstance = new ProviderV3();
						break;
					}
					case "v2": {
						const { default: ProviderV2 } = await import("./versions/v2");
						providerInstance = new ProviderV2();
						break;
					}
				}
			} catch (e) {
				logger.error(`[InfLink] 加载数据提供源时失败:`, e);
				providerInstance = null;
			}

			providerRef.current = providerInstance;
			setIsReady(true);
		};

		initializeProvider();

		return () => {
			if (providerRef.current) {
				providerRef.current.disabled = true;
				providerRef.current.dispatchEvent(new CustomEvent("disable"));
				if (typeof providerRef.current.dispose === "function") {
					providerRef.current.dispose();
				}
				providerRef.current = null;
			}
			setIsReady(false);
		};
	}, [version]);

	return isReady ? providerRef.current : null;
}

export function useSmtcConnection(
	infoProvider: BaseProvider | null,
	isEnabled: boolean,
) {
	useEffect(() => {
		if (!infoProvider) {
			return;
		}

		const smtcImplObj = SMTCNativeBackendInstance;

		if (!isEnabled) {
			smtcImplObj.disable();
			return;
		}

		const onUpdateSongInfo = (e: CustomEvent) => smtcImplObj.update(e.detail);
		const onUpdatePlayState = (e: CustomEvent) => {
			const status = e.detail === "Playing" ? "Playing" : "Paused";
			smtcImplObj.updatePlayState(status);
		};

		const onUpdateTimeline = (e: CustomEvent) =>
			smtcImplObj.updateTimeline(e.detail);

		const onUpdatePlayMode = (e: CustomEvent) =>
			smtcImplObj.updatePlayMode(e.detail);

		const onControl = (msg: ControlMessage) => {
			infoProvider.dispatchEvent(new CustomEvent("control", { detail: msg }));
		};

		infoProvider.addEventListener("updateSongInfo", onUpdateSongInfo);
		infoProvider.addEventListener("updatePlayState", onUpdatePlayState);
		infoProvider.addEventListener("updateTimeline", onUpdateTimeline);
		infoProvider.addEventListener("updatePlayMode", onUpdatePlayMode);

		const connectCallback = async () => {
			await infoProvider.ready;
			infoProvider.forceDispatchFullState();
		};

		smtcImplObj.initialize(onControl, connectCallback);

		return () => {
			infoProvider.removeEventListener("updateSongInfo", onUpdateSongInfo);
			infoProvider.removeEventListener("updatePlayState", onUpdatePlayState);
			infoProvider.removeEventListener("updateTimeline", onUpdateTimeline);
			infoProvider.removeEventListener("updatePlayMode", onUpdatePlayMode);
			smtcImplObj.disable();
		};
	}, [infoProvider, isEnabled]);
}

export interface NewVersionInfo {
	version: string;
	url: string;
}

export function useVersionCheck(repo: string): NewVersionInfo | null {
	const [newVersionInfo, setNewVersionInfo] = useState<NewVersionInfo | null>(
		null,
	);

	useEffect(() => {
		const checkVersion = async () => {
			try {
				const res = await fetch(
					`https://api.github.com/repos/${repo}/releases/latest`,
				);
				if (!res.ok) {
					throw new Error(`GitHub API 请求失败, 错误码: ${res.status}`);
				}
				const latestRelease = await res.json();
				const latestVersion = latestRelease.tag_name.replace(/^v/, "");
				const currentVersion = __APP_VERSION__;

				if (
					latestVersion.localeCompare(currentVersion, undefined, {
						numeric: true,
					}) > 0
				) {
					logger.info(`[InfLink-rs] 发现新版本: ${latestRelease.tag_name}`);
					setNewVersionInfo({
						version: latestRelease.tag_name,
						url: latestRelease.html_url,
					});
				}
			} catch (error) {
				logger.error("[InfLink-rs] 检查更新失败:", error);
			}
		};

		checkVersion();
	}, [repo]);

	return newVersionInfo;
}

function getNcmThemeMode(): PaletteMode {
	const currentTheme = localStorage.getItem("currentTheme") || "light";
	return /^dark/i.test(currentTheme) ? "dark" : "light";
}

export function useNcmTheme(): PaletteMode {
	const [ncmThemeMode, setNcmThemeMode] = useState(getNcmThemeMode);

	useEffect(() => {
		const handleStorageChange = (event: StorageEvent) => {
			if (event.key === "currentTheme") {
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
