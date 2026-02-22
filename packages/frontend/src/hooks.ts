import type { PaletteMode } from "@mui/material";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { NativeBackendInstance } from "./services/NativeBackend";
import { appConfigAtom } from "./store";
import type { IInfLinkApi } from "./types/api";
import type { ControlMessage } from "./types/backend";
import type { NcmAdapterError } from "./types/errors";
import logger from "./utils/logger";
import type { INcmAdapter, NcmAdapterEventMap } from "./versions/adapter";

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

export function useVersionWarning(version: NcmVersionInfo | null): boolean {
	if (!version) return false;

	const { major, minor, patch, raw } = version;

	if (major !== 2 && major !== 3) return true;
	if (major === 3 && minor !== 1) return true;

	// 这里的检查比 README.md 要宽松一点，因为 README.md 中的支持的版本是
	// 真的只在那个范围里测试了，但实际上插件应该也能在这个范围之外的一些版本工作
	if (major === 3 && minor === 1 && patch <= 15) return true;

	if (major === 2 && raw !== "2.10.13") return true;

	return false;
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

export function useInfoProvider(version: NcmVersionInfo | null): AdapterState {
	const [adapterState, setAdapterState] = useState<AdapterState>(
		INITIAL_ADAPTER_STATE,
	);

	useEffect(() => {
		let didUnmount = false;

		const initializeProvider = async () => {
			if (!version) {
				if (!didUnmount) {
					setAdapterState(INITIAL_ADAPTER_STATE);
				}
				return;
			}

			let adapter: INcmAdapter | null = null;
			switch (version.adapterVersion) {
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

export function useBackendConnection(adapterState: AdapterState) {
	const { adapter, status } = adapterState;

	const config = useAtomValue(appConfigAtom);
	const {
		smtcEnabled,
		discordEnabled,
		discordShowPaused,
		discordDisplayMode,
		appNameMode,
	} = config;

	const hasSentInitialMetadata = useRef(false);

	const configRef = useRef(config);
	useEffect(() => {
		configRef.current = config;
	}, [config]);

	const shouldConnect =
		status === "ready" && adapter && (smtcEnabled || discordEnabled);

	useEffect(() => {
		if (!shouldConnect || !adapter) {
			NativeBackendInstance.disable();
			hasSentInitialMetadata.current = false;
			return;
		}

		const nativeBackend = NativeBackendInstance;

		const onSongChange = (e: NcmAdapterEventMap["songChange"]) => {
			nativeBackend.update(e.detail);
			if (!hasSentInitialMetadata.current) {
				hasSentInitialMetadata.current = true;
				if (configRef.current.smtcEnabled) {
					nativeBackend.enableSmtcSession();
				}
			}
		};
		const onPlayStateChange = (e: NcmAdapterEventMap["playStateChange"]) =>
			nativeBackend.updatePlayState(e.detail);
		const onTimelineUpdate = (e: NcmAdapterEventMap["timelineUpdate"]) =>
			nativeBackend.updateTimeline(e.detail);
		const onPlayModeChange = (e: NcmAdapterEventMap["playModeChange"]) =>
			nativeBackend.updatePlayMode(e.detail);

		const onControl = (msg: ControlMessage) => {
			handleAdapterCommand(adapter, msg);
		};

		adapter.addEventListener("songChange", onSongChange);
		adapter.addEventListener("playStateChange", onPlayStateChange);
		adapter.addEventListener("timelineUpdate", onTimelineUpdate);
		adapter.addEventListener("playModeChange", onPlayModeChange);

		nativeBackend.initialize(onControl);

		return () => {
			adapter.removeEventListener("songChange", onSongChange);
			adapter.removeEventListener("playStateChange", onPlayStateChange);
			adapter.removeEventListener("timelineUpdate", onTimelineUpdate);
			adapter.removeEventListener("playModeChange", onPlayModeChange);
			nativeBackend.disable();
			hasSentInitialMetadata.current = false;
		};
	}, [shouldConnect, adapter]);

	useEffect(() => {
		if (!shouldConnect) return;

		const nativeBackend = NativeBackendInstance;

		if (smtcEnabled) {
			nativeBackend.enableSmtcSession();
		} else {
			nativeBackend.disableSmtcSession();
		}

		if (discordEnabled) {
			nativeBackend.enableDiscordRpc();
		} else {
			nativeBackend.disableDiscordRpc();
		}

		nativeBackend.updateDiscordConfig({
			showWhenPaused: discordShowPaused,
			displayMode: discordDisplayMode,
			appNameMode: appNameMode,
		});
	}, [
		shouldConnect,
		smtcEnabled,
		discordEnabled,
		discordShowPaused,
		discordDisplayMode,
		appNameMode,
	]);
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
