import type { PaletteMode } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { STORE_KEY_RESOLUTION } from "./keys";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import type { IInfLinkApi } from "./types/api";
import type { NcmAdapterError } from "./types/errors";
import type { ControlMessage } from "./types/smtc";
import logger from "./utils/logger";
import type { INcmAdapter, NcmAdapterEventMap } from "./versions/adapter";

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

export interface AdapterState {
	adapter: INcmAdapter | null;
	status: "loading" | "ready" | "error";
	error: NcmAdapterError | null;
}

const INITIAL_ADAPTER_STATE: AdapterState = {
	adapter: null,
	status: "loading",
	error: null,
};

export function useInfoProvider(version: NcmVersion | null): AdapterState {
	const [adapterState, setAdapterState] = useState<AdapterState>(
		INITIAL_ADAPTER_STATE,
	);

	useEffect(() => {
		let didUnmount = false;

		const initializeProvider = async () => {
			if (!version || version === "unsupported") {
				if (!didUnmount) {
					setAdapterState(INITIAL_ADAPTER_STATE);
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
					setAdapterState({
						adapter: null,
						status: "error",
						error: initResult.error,
					});
					return;
				} else {
					setAdapterState({
						adapter: adapter,
						status: "ready",
						error: null,
					});

					return () => {
						adapter?.dispose();
					};
				}
			} else {
				if (!didUnmount) {
					setAdapterState(INITIAL_ADAPTER_STATE);
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

	return adapterState;
}

function handleAdapterCommand(adapter: INcmAdapter, msg: ControlMessage) {
	switch (msg.type) {
		case "Play":
			adapter.play();
			break;
		case "Pause":
			adapter.pause();
			break;
		case "Stop":
			adapter.stop();
			break;
		case "NextSong":
			adapter.nextSong();
			break;
		case "PreviousSong":
			adapter.previousSong();
			break;
		case "Seek":
			adapter.seekTo(msg.position_ms);
			break;
		case "ToggleShuffle":
			adapter.toggleShuffle();
			break;
		case "ToggleRepeat":
			adapter.toggleRepeat();
			break;
		case "SetRepeat":
			adapter.setRepeatMode(msg.mode);
			break;
		case "SetVolume":
			adapter.setVolume(msg.level);
			break;
		case "ToggleMute":
			adapter.toggleMute();
			break;
		default:
			logger.warn(`未处理的命令:`, "handleAdapterCommand", msg);
			break;
	}
}

export function useBackendConnection(
	adapterState: AdapterState,
	smtcEnabled: boolean,
	discordEnabled: boolean,
	discordShowPaused: boolean,
) {
	const { adapter, status } = adapterState;
	const hasSentInitialMetadata = useRef(false);

	const configRef = useRef({ smtcEnabled, discordEnabled, discordShowPaused });
	useEffect(() => {
		configRef.current = { smtcEnabled, discordEnabled, discordShowPaused };
	}, [smtcEnabled, discordEnabled, discordShowPaused]);

	const shouldConnect =
		status === "ready" && adapter && (smtcEnabled || discordEnabled);

	useEffect(() => {
		if (!shouldConnect || !adapter) {
			SMTCNativeBackendInstance.disable();
			hasSentInitialMetadata.current = false;
			return;
		}

		const smtcImplObj = SMTCNativeBackendInstance;

		const onSongChange = (e: NcmAdapterEventMap["songChange"]) => {
			smtcImplObj.update(e.detail);
			if (!hasSentInitialMetadata.current) {
				hasSentInitialMetadata.current = true;
				if (configRef.current.smtcEnabled) {
					smtcImplObj.enableSmtcSession();
				}
			}
		};
		const onPlayStateChange = (e: NcmAdapterEventMap["playStateChange"]) =>
			smtcImplObj.updatePlayState(e.detail);
		const onTimelineUpdate = (e: NcmAdapterEventMap["timelineUpdate"]) =>
			smtcImplObj.updateTimeline(e.detail);
		const onPlayModeChange = (e: NcmAdapterEventMap["playModeChange"]) =>
			smtcImplObj.updatePlayMode(e.detail);

		const onControl = (msg: ControlMessage) => {
			handleAdapterCommand(adapter, msg);
		};

		adapter.addEventListener("songChange", onSongChange);
		adapter.addEventListener("playStateChange", onPlayStateChange);
		adapter.addEventListener("timelineUpdate", onTimelineUpdate);
		adapter.addEventListener("playModeChange", onPlayModeChange);

		smtcImplObj.initialize(onControl);

		return () => {
			adapter.removeEventListener("songChange", onSongChange);
			adapter.removeEventListener("playStateChange", onPlayStateChange);
			adapter.removeEventListener("timelineUpdate", onTimelineUpdate);
			adapter.removeEventListener("playModeChange", onPlayModeChange);
			smtcImplObj.disable();
			hasSentInitialMetadata.current = false;
		};
	}, [shouldConnect, adapter]);

	useEffect(() => {
		if (!shouldConnect) return;

		const smtcImplObj = SMTCNativeBackendInstance;

		if (smtcEnabled) {
			smtcImplObj.enableSmtcSession();
		} else {
			smtcImplObj.disableSmtcSession();
		}

		if (discordEnabled) {
			smtcImplObj.enableDiscordRpc();
		} else {
			smtcImplObj.disableDiscordRpc();
		}

		smtcImplObj.updateDiscordConfig({
			showWhenPaused: discordShowPaused,
		});
	}, [shouldConnect, smtcEnabled, discordEnabled, discordShowPaused]);
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

export function useGlobalApi(adapter: INcmAdapter | null) {
	useEffect(() => {
		if (adapter) {
			const api: IInfLinkApi = {
				getCurrentSong: () => adapter.getCurrentSongInfo().unwrapOr(null),
				getPlaybackStatus: () => adapter.getPlaybackStatus(),
				getTimeline: () => adapter.getTimelineInfo().unwrapOr(null),
				getPlayMode: () => adapter.getPlayMode(),
				getVolume: () => adapter.getVolumeInfo(),

				play: () => handleAdapterCommand(adapter, { type: "Play" }),
				pause: () => handleAdapterCommand(adapter, { type: "Pause" }),
				stop: () => handleAdapterCommand(adapter, { type: "Stop" }),
				next: () => handleAdapterCommand(adapter, { type: "NextSong" }),
				previous: () => handleAdapterCommand(adapter, { type: "PreviousSong" }),
				seekTo: (pos) =>
					handleAdapterCommand(adapter, { type: "Seek", position_ms: pos }),
				toggleShuffle: () =>
					handleAdapterCommand(adapter, { type: "ToggleShuffle" }),
				toggleRepeat: () =>
					handleAdapterCommand(adapter, { type: "ToggleRepeat" }),
				setRepeatMode: (mode) =>
					handleAdapterCommand(adapter, { type: "SetRepeat", mode }),
				setVolume: (level) =>
					handleAdapterCommand(adapter, { type: "SetVolume", level }),
				toggleMute: () => handleAdapterCommand(adapter, { type: "ToggleMute" }),

				addEventListener: (type, listener) =>
					adapter.addEventListener(type, listener),
				removeEventListener: (type, listener) =>
					adapter.removeEventListener(type, listener),
			};

			window.InfLinkApi = api;

			return () => {
				delete window.InfLinkApi;
			};
		}
		return;
	}, [adapter]);
}
