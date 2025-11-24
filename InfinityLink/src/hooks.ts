import type { PaletteMode } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { STORE_KEY_RESOLUTION } from "./keys";
import { SmtcProvider } from "./provider";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import type { IInfLinkApi } from "./types/api";
import type { NcmAdapterError } from "./types/errors";
import type { ControlMessage, ProviderEventMap } from "./types/smtc";
import logger from "./utils/logger";
import type { INcmAdapter } from "./versions/adapter";

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
 * @returns 'v3', 'v2', 'unsupported', 或 null (检测中)
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
			logger.error("无法检测网易云音乐版本", "useNcmVersion", e);
			setVersion("unsupported");
		}
	}, []);

	return version;
}

export interface ProviderState {
	provider: SmtcProvider | null;
	status: "loading" | "ready" | "error";
	error: NcmAdapterError | null;
}

const INITIAL_PROVIDER_STATE: ProviderState = {
	provider: null,
	status: "loading",
	error: null,
};

export function useInfoProvider(version: NcmVersion | null): ProviderState {
	const [providerState, setProviderState] = useState<ProviderState>(
		INITIAL_PROVIDER_STATE,
	);

	useEffect(() => {
		let didUnmount = false;

		const initializeProvider = async () => {
			if (!version || version === "unsupported") {
				if (!didUnmount) {
					setProviderState(INITIAL_PROVIDER_STATE);
				}
				return;
			}

			let adapter: INcmAdapter | null = null;
			switch (version) {
				case "v3": {
					const { V3NcmAdapter } = await import("./versions/v3/adapter");
					adapter = new V3NcmAdapter();
					break;
				}
				case "v2": {
					const { V2NcmAdapter } = await import("./versions/v2/adapter");
					adapter = new V2NcmAdapter();
					break;
				}
			}

			if (adapter) {
				const initResult = await adapter.initialize();

				if (didUnmount) {
					return;
				}

				if (initResult.isErr()) {
					logger.error(
						`Adapter 初始化失败:`,
						"useInfoProvider",
						initResult.error,
					);
					setProviderState({
						provider: null,
						status: "error",
						error: initResult.error,
					});
					return;
				} else {
					const newProvider = new SmtcProvider(adapter);
					setProviderState({
						provider: newProvider,
						status: "ready",
						error: null,
					});

					return () => {
						newProvider.dispose();
					};
				}
			} else {
				if (!didUnmount) {
					setProviderState(INITIAL_PROVIDER_STATE);
				}
				return;
			}
		};

		let cleanupProvider: (() => void) | undefined;
		initializeProvider().then((cleanup) => {
			if (typeof cleanup === "function") {
				cleanupProvider = cleanup;
			}
		});

		return () => {
			didUnmount = true;
			if (cleanupProvider) {
				cleanupProvider();
			}
		};
	}, [version]);

	return providerState;
}

export function useSmtcConnection(
	providerState: ProviderState,
	isEnabled: boolean,
) {
	const { provider, status } = providerState;
	const hasSentInitialMetadata = useRef(false);

	useEffect(() => {
		if (status !== "ready" || !provider) {
			return;
		}

		const smtcImplObj = SMTCNativeBackendInstance;

		if (!isEnabled) {
			smtcImplObj.disable();
			return;
		}

		const onUpdateSongInfo = (e: ProviderEventMap["updateSongInfo"]) => {
			smtcImplObj.update(e.detail);
			if (isEnabled && !hasSentInitialMetadata.current) {
				hasSentInitialMetadata.current = true;
				smtcImplObj.enableSmtcSession();
			}
		};
		const onUpdatePlayState = (e: ProviderEventMap["updatePlayState"]) =>
			smtcImplObj.updatePlayState(e.detail);
		const onUpdateTimeline = (e: ProviderEventMap["updateTimeline"]) =>
			smtcImplObj.updateTimeline(e.detail);
		const onUpdatePlayMode = (e: ProviderEventMap["updatePlayMode"]) =>
			smtcImplObj.updatePlayMode(e.detail);

		const onControl = (msg: ControlMessage) => {
			provider.handleControlCommand(msg);
		};

		provider.addEventListener("updateSongInfo", onUpdateSongInfo);
		provider.addEventListener("updatePlayState", onUpdatePlayState);
		provider.addEventListener("updateTimeline", onUpdateTimeline);
		provider.addEventListener("updatePlayMode", onUpdatePlayMode);

		const connectCallback = async () => {
			await provider.ready;
			provider.forceDispatchFullState();
		};

		smtcImplObj.initialize(onControl, connectCallback);

		return () => {
			provider.removeEventListener("updateSongInfo", onUpdateSongInfo);
			provider.removeEventListener("updatePlayState", onUpdatePlayState);
			provider.removeEventListener("updateTimeline", onUpdateTimeline);
			provider.removeEventListener("updatePlayMode", onUpdatePlayMode);
			smtcImplObj.disable();
			hasSentInitialMetadata.current = false;
		};
	}, [provider, status, isEnabled]);
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
					(latestVersion as string).localeCompare(currentVersion, undefined, {
						numeric: true,
					}) > 0
				) {
					logger.info(
						`发现新版本: ${latestRelease.tag_name}`,
						"useVersionCheck",
					);
					setNewVersionInfo({
						version: latestRelease.tag_name,
						url: latestRelease.html_url,
					});
				}
			} catch (error) {
				logger.error("检查更新失败:", "useVersionCheck", error);
			}
		};

		checkVersion();
	}, [repo]);

	return newVersionInfo;
}

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

export type ResolutionSetting = string;

export function useResolutionSetting(): [
	ResolutionSetting,
	(value: ResolutionSetting) => void,
] {
	const [resolution, setResolution] = useLocalStorage<ResolutionSetting>(
		STORE_KEY_RESOLUTION,
		"500",
	);
	return [resolution, setResolution];
}

export function useGlobalApi(provider: SmtcProvider | null) {
	useEffect(() => {
		if (provider) {
			const api: IInfLinkApi = {
				getCurrentSong: () => provider.getCurrentSongInfo().unwrapOr(null),
				getPlaybackStatus: () => provider.getPlaybackStatus(),
				getTimeline: () => provider.getTimelineInfo().unwrapOr(null),
				getPlayMode: () => provider.getPlayMode(),
				getVolume: () => provider.getVolume(),

				play: () => provider.handleControlCommand({ type: "Play" }),
				pause: () => provider.handleControlCommand({ type: "Pause" }),
				stop: () => provider.handleControlCommand({ type: "Stop" }),
				next: () => provider.handleControlCommand({ type: "NextSong" }),
				previous: () => provider.handleControlCommand({ type: "PreviousSong" }),
				seekTo: (pos) =>
					provider.handleControlCommand({ type: "Seek", position: pos }),

				toggleShuffle: () =>
					provider.handleControlCommand({ type: "ToggleShuffle" }),
				toggleRepeat: () =>
					provider.handleControlCommand({ type: "ToggleRepeat" }),
				setRepeatMode: (mode) =>
					provider.handleControlCommand({ type: "SetRepeat", mode }),
				setVolume: (level) =>
					provider.handleControlCommand({ type: "SetVolume", level }),
				toggleMute: () => provider.handleControlCommand({ type: "ToggleMute" }),

				addEventListener: (type, listener) =>
					provider.addEventListener(type, listener),
				removeEventListener: (type, listener) =>
					provider.removeEventListener(type, listener),
			};

			window.InfLinkApi = api;

			return () => {
				delete window.InfLinkApi;
			};
		}
		return;
	}, [provider]);
}
