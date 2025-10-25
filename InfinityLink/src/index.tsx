/**
 * @fileoverview
 * 此处的脚本将会在插件管理器加载插件期间被加载
 * 一般情况下只需要从这个入口点进行开发即可满足绝大部分需求
 */

import UpgradeIcon from "@mui/icons-material/Upgrade";
import {
	Alert,
	AlertTitle,
	Autocomplete,
	Box,
	Button,
	CircularProgress,
	FormControl,
	FormControlLabel,
	FormGroup,
	InputLabel,
	Link,
	MenuItem,
	Select,
	Switch,
	TextField,
	Typography,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useEffect, useId, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	useInfoProvider,
	useLocalStorage,
	useNcmTheme,
	useNcmVersion,
	useResolutionSetting,
	useSmtcConnection,
	useVersionCheck,
} from "./hooks";
import {
	STORE_KEY_BACKEND_LOG_LEVEL,
	STORE_KEY_FRONTEND_LOG_LEVEL,
	STORE_KEY_NATIVE_SMTC_CONFLICT_RESOLVED,
	STORE_KEY_SMTC_ENABLED,
} from "./keys";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import type { IInfLinkApi } from "./types/api";
import logger, { type LogLevel, setLogLevel } from "./utils/logger";

const configElement = document.createElement("div");

const GITHUB_REPO = "apoint123/InfLink-rs";

/**
 * 猴子补丁 localStorage.setItem 以便在当前页面也能监听到变化
 *
 * 用来实时同步当前的主题
 */
function patchLocalStorage() {
	const originalSetItem = localStorage.setItem;

	localStorage.setItem = function (key: string, value: string) {
		const oldValue = localStorage.getItem(key);

		originalSetItem.call(this, key, value);

		const event = new StorageEvent("storage", {
			key,
			newValue: value,
			oldValue,
			storageArea: localStorage,
		});
		window.dispatchEvent(event);
	};
}

plugin.onLoad((selfPlugin) => {
	logger.info("插件正在加载...", "onLoad", selfPlugin);

	patchLocalStorage();

	try {
		createRoot(configElement).render(<App />);
	} catch (error) {
		logger.error("React 组件渲染失败:", "onLoad", error);
	}
});

const logLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error"];

function App() {
	const ncmThemeMode = useNcmTheme();

	const theme = useMemo(
		() =>
			createTheme({
				palette: {
					mode: ncmThemeMode,
				},
				typography: {
					fontFamily: [
						'"Noto Sans SC"',
						'"Microsoft YaHei"',
						'"Segoe UI"',
						"Roboto",
						'"Helvetica Neue"',
						"Arial",
						"sans-serif",
					].join(","),
				},
			}),
		[ncmThemeMode],
	);

	return (
		<ThemeProvider theme={theme}>
			<Main />
		</ThemeProvider>
	);
}

function Main() {
	const ncmVersion = useNcmVersion();

	const [SMTCEnabled, setSMTCEnabled] = useLocalStorage(
		STORE_KEY_SMTC_ENABLED,
		true,
	);
	const [frontendLogLevel, setFrontendLogLevel] = useLocalStorage<LogLevel>(
		STORE_KEY_FRONTEND_LOG_LEVEL,
		"warn",
	);
	const [backendLogLevel, setBackendLogLevel] = useLocalStorage<LogLevel>(
		STORE_KEY_BACKEND_LOG_LEVEL,
		"warn",
	);
	const [nativeSmtcResolved, setNativeSmtcResolved] = useLocalStorage(
		STORE_KEY_NATIVE_SMTC_CONFLICT_RESOLVED,
		false,
	);
	const [conflictState, setConflictState] = useState<
		"checking" | "conflict" | "no_conflict"
	>("checking");

	const [resolution, setResolution] = useResolutionSetting();

	const frontendId = useId();
	const backendId = useId();
	const predefinedResolutions = ["300", "500", "1024", "max"];

	const newVersionInfo = useVersionCheck(GITHUB_REPO);

	const providerState = useInfoProvider(ncmVersion);
	const { provider, status, error } = providerState;

	const isSmtcReadyToEnable =
		SMTCEnabled && (conflictState === "no_conflict" || nativeSmtcResolved);

	useSmtcConnection(providerState, isSmtcReadyToEnable);

	useEffect(() => {
		if (status === "ready" && provider) {
			const hasSupport = provider.adapter.hasNativeSmtcSupport();
			if (hasSupport) {
				logger.info("检测到内置的 SMTC 功能", "Main");
				setConflictState("conflict");
			} else {
				setConflictState("no_conflict");
			}
		}
	}, [status, provider]);

	useEffect(() => {
		if (status !== "ready" || !provider || conflictState !== "conflict") {
			return;
		}

		if (nativeSmtcResolved) {
			provider.adapter.setNativeSmtc(false);
		}
	}, [status, provider, conflictState, nativeSmtcResolved]);

	useEffect(() => {
		if (ncmVersion !== null) {
			logger.debug(`兼容的版本: ${ncmVersion}`, "Main");
		}
	}, [ncmVersion]);

	useEffect(() => {
		logger.debug(`SMTC 支持: ${SMTCEnabled}`, "Main");
	}, [SMTCEnabled]);

	useEffect(() => {
		setLogLevel(frontendLogLevel);
		logger.debug(`设置前端日志级别为: ${frontendLogLevel}`, "Main");
	}, [frontendLogLevel]);

	useEffect(() => {
		SMTCNativeBackendInstance.setBackendLogLevel(backendLogLevel);
	}, [backendLogLevel]);

	useEffect(() => {
		if (provider) {
			provider.setResolution(resolution);
		}
	}, [provider, resolution]);

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

	if (ncmVersion === null || status === "loading") {
		return (
			<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
				<CircularProgress size={24} />
				<Typography variant="body2">正在初始化...</Typography>
			</Box>
		);
	}

	if (ncmVersion === "unsupported") {
		return (
			<Alert severity="error">
				<AlertTitle>不兼容的网易云音乐版本</AlertTitle>
				InfLink-rs 不支持当前版本的网易云音乐, 请使用原版 InfLink 作为代替
			</Alert>
		);
	}

	if (status === "error") {
		return (
			<Alert severity="error">
				<AlertTitle>插件初始化失败</AlertTitle>
				部分组件未能初始化, 请尝试重启网易云音乐, 或者打开控制台查看详细信息
				<br />
				错误信息: {error?.message || "未知错误"}
			</Alert>
		);
	}

	return (
		<div>
			{conflictState === "conflict" && !nativeSmtcResolved && (
				<Alert severity="error" sx={{ mb: 2 }}>
					<AlertTitle>检测到网易云内置的 SMTC 功能</AlertTitle>
					<Box>
						<Typography variant="body2" component="div">
							这会与 InfLink-rs 插件产生冲突，因此已禁用本插件的 SMTC 功能
						</Typography>
						<Typography variant="body2" component="div" sx={{ mt: 1 }}>
							建议禁用内置的 SMTC 功能以获得最佳体验
						</Typography>
					</Box>
					<Button
						variant="contained"
						size="medium"
						onClick={() => {
							provider?.adapter.setNativeSmtc(false);
							setNativeSmtcResolved(true);
							setSMTCEnabled(true);
						}}
						sx={{ mt: 1.5 }}
					>
						帮我禁用
					</Button>
				</Alert>
			)}

			{newVersionInfo && (
				<Alert severity="info" sx={{ mb: 2 }}>
					<AlertTitle>发现新版本: {newVersionInfo.version} !</AlertTitle>
					<Box>
						<Typography variant="body2" component="div">
							下载新版本以获得最新功能和修复
						</Typography>
						<Typography variant="body2" component="div">
							在左侧插件商店进行更新，或者点击下方按钮手动下载插件进行更新
						</Typography>
					</Box>
					<Button
						variant="contained"
						size="medium"
						startIcon={<UpgradeIcon />}
						onClick={() => betterncm.ncm.openUrl(newVersionInfo.url)}
						sx={{ mt: 1.5 }}
					>
						前往下载
					</Button>
				</Alert>
			)}

			<Typography variant="h6" gutterBottom>
				InfLink-rs 设置
			</Typography>
			<FormGroup>
				<FormControlLabel
					control={
						<Switch
							checked={SMTCEnabled}
							onChange={(_e, checked) => setSMTCEnabled(checked)}
						/>
					}
					label="启用 SMTC 支持"
					disabled={conflictState === "conflict" && !nativeSmtcResolved}
				/>
				{conflictState === "conflict" && nativeSmtcResolved && (
					<Typography variant="body2" color="textSecondary">
						已禁用网易云内置的 SMTC 功能
						<Link
							component="button"
							variant="body2"
							onClick={() => {
								provider?.adapter.setNativeSmtc(true);
								setNativeSmtcResolved(false);
								setSMTCEnabled(false);
							}}
							sx={{ ml: 1, mt: -0.5 }}
						>
							点我恢复
						</Link>
					</Typography>
				)}
			</FormGroup>

			<Box sx={{ mt: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
				<FormControl size="small">
					<InputLabel id={frontendId}>前端日志级别</InputLabel>
					<Select
						labelId={frontendId}
						value={frontendLogLevel}
						label="前端日志级别"
						onChange={(e) => setFrontendLogLevel(e.target.value as LogLevel)}
						sx={{ minWidth: 120 }}
					>
						{logLevels.map((level) => (
							<MenuItem key={level} value={level}>
								{level}
							</MenuItem>
						))}
					</Select>
				</FormControl>
				<FormControl size="small">
					<InputLabel id={backendId}>后端日志级别</InputLabel>
					<Select
						labelId={backendId}
						value={backendLogLevel}
						label="后端日志级别"
						onChange={(e) => setBackendLogLevel(e.target.value as LogLevel)}
						sx={{ minWidth: 120 }}
					>
						{logLevels.map((level) => (
							<MenuItem key={level} value={level}>
								{level}
							</MenuItem>
						))}
					</Select>
				</FormControl>
				<FormControl size="small" sx={{ minWidth: 150 }}>
					<Autocomplete
						freeSolo
						value={resolution}
						options={predefinedResolutions}
						onChange={(_event, newValue) => {
							if (
								newValue &&
								(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
							) {
								setResolution(newValue);
							}
						}}
						onBlur={(event) => {
							const newValue = (event.target as HTMLInputElement).value;
							if (
								newValue &&
								(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
							) {
								setResolution(newValue);
							}
						}}
						renderInput={(params) => {
							const { InputLabelProps, ...rest } = params;
							const { className, style, ...restInputLabelProps } =
								InputLabelProps;
							return (
								<TextField
									{...rest}
									slotProps={{
										inputLabel: {
											...restInputLabelProps,
											...(className && { className }),
											...(style && { style }),
										},
									}}
									label="封面分辨率"
									size="small"
									helperText="过大的值可能会影响封面加载速度"
								/>
							);
						}}
					/>
				</FormControl>
			</Box>
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
