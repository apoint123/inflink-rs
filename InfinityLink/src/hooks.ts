import type { PaletteMode } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import { ReactStoreProvider } from "./SongInfoProviders/ReactStoreProvider";
import type { ControlMessage } from "./types/smtc";
import logger from "./utils/logger";

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

export function useCompatibility(): boolean | null {
	const [isCompatible, setIsCompatible] = useState<boolean | null>(null);

	useEffect(() => {
		try {
			const version = betterncm.ncm.getNCMVersion();
			const majorVersion = parseInt(version.split(".")[0], 10);
			setIsCompatible(majorVersion >= 3);
		} catch (e) {
			logger.error("[InfLink-rs] 无法检测网易云音乐版本。", e);
			setIsCompatible(false);
		}
	}, []);

	return isCompatible;
}

export function useInfoProvider(
	isCompatible: boolean | null,
): ReactStoreProvider | null {
	const providerRef = useRef<ReactStoreProvider | null>(null);
	const [isReady, setIsReady] = useState(false);

	useEffect(() => {
		if (isCompatible) {
			const provider = new ReactStoreProvider();
			providerRef.current = provider;
			setIsReady(true);

			return () => {
				provider.disabled = true;
				provider.dispatchEvent(new CustomEvent("disable"));
				if ("dispose" in provider && typeof provider.dispose === "function") {
					provider.dispose();
				}
				providerRef.current = null;
				setIsReady(false);
			};
		}
	}, [isCompatible]);

	return isReady ? providerRef.current : null;
}

export function useSmtcConnection(
	infoProvider: ReactStoreProvider | null,
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

		const onControl = (msg: ControlMessage) => {
			infoProvider.dispatchEvent(new CustomEvent("control", { detail: msg }));
		};

		infoProvider.addEventListener("updateSongInfo", onUpdateSongInfo);
		infoProvider.addEventListener("updatePlayState", onUpdatePlayState);
		infoProvider.addEventListener("updateTimeline", onUpdateTimeline);
		infoProvider.onPlayModeChange = (detail) => {
			smtcImplObj.updatePlayMode(detail);
		};

		const connectCallback = async () => {
			await infoProvider.ready;
			infoProvider.forceDispatchFullState();
		};

		smtcImplObj.initialize(onControl, connectCallback);

		return () => {
			infoProvider.removeEventListener("updateSongInfo", onUpdateSongInfo);
			infoProvider.removeEventListener("updatePlayState", onUpdatePlayState);
			infoProvider.removeEventListener("updateTimeline", onUpdateTimeline);
			infoProvider.onPlayModeChange = null;
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
