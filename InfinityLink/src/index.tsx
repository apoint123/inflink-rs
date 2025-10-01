/**
 * @fileoverview
 * 此处的脚本将会在插件管理器加载插件期间被加载
 * 一般情况下只需要从这个入口点进行开发即可满足绝大部分需求
 */

import UpgradeIcon from "@mui/icons-material/Upgrade";
import {
	Alert,
	AlertTitle,
	Box,
	Button,
	CircularProgress,
	FormControl,
	FormControlLabel,
	FormGroup,
	InputLabel,
	MenuItem,
	Select,
	Switch,
	Typography,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useEffect, useId, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
	useCompatibility,
	useInfoProvider,
	useLocalStorage,
	useNcmTheme,
	useSmtcConnection,
	useVersionCheck,
} from "./hooks";
import {
	STORE_KEY_BACKEND_LOG_LEVEL,
	STORE_KEY_FRONTEND_LOG_LEVEL,
	STORE_KEY_SMTC_ENABLED,
} from "./keys";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
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
	logger.info("[InfLink-rs] 插件正在加载...", selfPlugin);

	patchLocalStorage();

	try {
		createRoot(configElement).render(<App />);
	} catch (error) {
		logger.error("[InfLink-rs] React 组件渲染失败:", error);
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
	const isCompatible = useCompatibility();
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

	const frontendId = useId();
	const backendId = useId();

	const newVersionInfo = useVersionCheck(GITHUB_REPO);
	const infoProvider = useInfoProvider(isCompatible);
	useSmtcConnection(infoProvider, SMTCEnabled);

	useEffect(() => {
		if (isCompatible !== null) {
			logger.debug(
				`[InfLink] 兼容性检查结果: ${
					isCompatible ? "Compatible" : "Incompatible"
				}`,
			);
		}
	}, [isCompatible]);

	useEffect(() => {
		logger.debug(`[InfLink] SMTC 支持: ${SMTCEnabled}`);
	}, [SMTCEnabled]);

	useEffect(() => {
		if (newVersionInfo) {
			logger.info(`[InfLink] New version detected: ${newVersionInfo.version}`);
		}
	}, [newVersionInfo]);

	useEffect(() => {
		setLogLevel(frontendLogLevel);
		logger.debug(`[InfLink] 设置前端日志级别为: ${frontendLogLevel}`);
	}, [frontendLogLevel]);

	useEffect(() => {
		SMTCNativeBackendInstance.setBackendLogLevel(backendLogLevel);
	}, [backendLogLevel]);

	if (isCompatible === null) {
		return <CircularProgress size={24} />;
	}

	if (isCompatible === false) {
		return (
			<Alert severity="error">
				<AlertTitle>不兼容的网易云音乐版本</AlertTitle>
				InfLink-rs 需要网易云音乐 v3.0.0 或更高版本才能运行。请使用原版 InfLink
				作为代替。
			</Alert>
		);
	}

	return (
		<div>
			{newVersionInfo && (
				<Alert severity="info" sx={{ mb: 2 }}>
					<AlertTitle>发现新版本: {newVersionInfo.version} !</AlertTitle>
					<Box>
						<Typography variant="body2" component="div">
							下载新版本以获得最新功能和修复
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
				/>
			</FormGroup>

			<Box sx={{ mt: 2, display: "flex", gap: 2 }}>
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
			</Box>
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
