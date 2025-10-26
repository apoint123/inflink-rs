/**
 * @fileoverview
 * 此处的脚本将会在插件管理器加载插件期间被加载
 * 一般情况下只需要从这个入口点进行开发即可满足绝大部分需求
 */

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UpgradeIcon from "@mui/icons-material/Upgrade";
import {
	Accordion,
	AccordionDetails,
	AccordionSummary,
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
	MenuItem,
	Select,
	Switch,
	TextField,
	Typography,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { StrictMode, useEffect, useId, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	useGlobalApi,
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
	STORE_KEY_INTERNAL_LOGGING_ENABLED,
	STORE_KEY_SMTC_ENABLED,
} from "./keys";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import logger, { type LogLevel, setLogLevel } from "./utils/logger";

const configElement = document.createElement("div");

const GITHUB_REPO = "apoint123/InfLink-rs";

type PatchedSetItem = {
	(key: string, value: string): void;
	__isPatchedByInfLink?: boolean;
};

/**
 * 猴子补丁 localStorage.setItem 以便在当前页面也能监听到变化
 *
 * 用来实时同步当前的主题
 */
function patchLocalStorage() {
	if ((localStorage.setItem as PatchedSetItem).__isPatchedByInfLink) {
		return;
	}

	const originalSetItem = localStorage.setItem;

	localStorage.setItem = (key: string, value: string) => {
		const oldValue = localStorage.getItem(key);

		originalSetItem.call(localStorage, key, value);

		const event = new StorageEvent("storage", {
			key,
			newValue: value,
			oldValue,
			storageArea: localStorage,
		});
		window.dispatchEvent(event);
	};

	(localStorage.setItem as PatchedSetItem).__isPatchedByInfLink = true;
}

plugin.onLoad((selfPlugin) => {
	logger.info("插件正在加载...", "onLoad", selfPlugin);

	patchLocalStorage();

	try {
		createRoot(configElement).render(
			<StrictMode>
				<App />
			</StrictMode>,
		);
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

function LoadingIndicator() {
	return (
		<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
			<CircularProgress size={24} />
			<Typography variant="body2">正在初始化...</Typography>
		</Box>
	);
}

function UnsupportedVersionAlert() {
	return (
		<Alert severity="error">
			<AlertTitle>不兼容的网易云音乐版本</AlertTitle>
			InfLink-rs 不支持当前版本的网易云音乐, 请使用原版 InfLink 作为代替
		</Alert>
	);
}

function InitializationErrorAlert({ error }: { error: Error | null }) {
	return (
		<Alert severity="error">
			<AlertTitle>插件初始化失败</AlertTitle>
			部分组件未能初始化, 请尝试重启网易云音乐, 或者打开控制台查看详细信息
			<br />
			错误信息: {error?.message || "未知错误"}
		</Alert>
	);
}

interface NewVersionAlertProps {
	newVersionInfo: { version: string; url: string };
}

function NewVersionAlert({ newVersionInfo }: NewVersionAlertProps) {
	return (
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
	);
}

interface SmtcSettingsProps {
	smtcEnabled: boolean;
	onSmtcEnabledChange: (enabled: boolean) => void;
}

function SmtcSettings({ smtcEnabled, onSmtcEnabledChange }: SmtcSettingsProps) {
	return (
		<>
			<Typography variant="h6" gutterBottom sx={{ mt: 2, fontSize: "1rem" }}>
				SMTC 设置
			</Typography>
			<FormGroup>
				<FormControlLabel
					control={
						<Switch
							checked={smtcEnabled}
							onChange={(_e, checked) => onSmtcEnabledChange(checked)}
						/>
					}
					label="启用 SMTC 支持"
				/>
			</FormGroup>
		</>
	);
}

interface ResolutionSettingsProps {
	resolution: string;
	onResolutionChange: (resolution: string) => void;
}

function ResolutionSettings({
	resolution,
	onResolutionChange,
}: ResolutionSettingsProps) {
	const predefinedResolutions = ["300", "500", "1024", "max"];

	const handleChange = (_event: unknown, newValue: string | null) => {
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			onResolutionChange(newValue);
		}
	};

	const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
		const newValue = (event.target as HTMLInputElement).value;
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			onResolutionChange(newValue);
		}
	};

	return (
		<Box sx={{ mt: 3 }}>
			<FormControl size="small" sx={{ minWidth: 150 }}>
				<Autocomplete
					freeSolo
					value={resolution}
					options={predefinedResolutions}
					onChange={handleChange}
					onBlur={handleBlur}
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
	);
}

interface AdvancedSettingsProps {
	frontendLogLevel: LogLevel;
	backendLogLevel: LogLevel;
	internalLogging: boolean;
	onFrontendLogLevelChange: (level: LogLevel) => void;
	onBackendLogLevelChange: (level: LogLevel) => void;
	onInternalLoggingChange: (enabled: boolean) => void;
}

function AdvancedSettings({
	frontendLogLevel,
	backendLogLevel,
	internalLogging,
	onFrontendLogLevelChange,
	onBackendLogLevelChange,
	onInternalLoggingChange,
}: AdvancedSettingsProps) {
	const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
	const frontendId = useId();
	const backendId = useId();

	return (
		<Accordion
			expanded={isAdvancedExpanded}
			onChange={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
			elevation={0}
			disableGutters
			sx={{
				backgroundColor: "transparent",
				"&::before": {
					display: "none",
				},
				mt: 2,
			}}
		>
			<AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ padding: 0 }}>
				<Typography variant="h6" gutterBottom sx={{ fontSize: "1rem" }}>
					高级设置
				</Typography>
			</AccordionSummary>
			<AccordionDetails sx={{ padding: 0, pt: 2 }}>
				<Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
					<FormControl size="small">
						<InputLabel id={frontendId}>前端日志级别</InputLabel>
						<Select
							labelId={frontendId}
							value={frontendLogLevel}
							label="前端日志级别"
							onChange={(e) =>
								onFrontendLogLevelChange(e.target.value as LogLevel)
							}
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
							onChange={(e) =>
								onBackendLogLevelChange(e.target.value as LogLevel)
							}
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
				<FormGroup sx={{ mt: 2 }}>
					<FormControlLabel
						control={
							<Switch
								checked={internalLogging}
								onChange={(_e, checked) => onInternalLoggingChange(checked)}
							/>
						}
						label="转发网易云内部的日志到控制台"
					/>
					<Typography
						variant="body2"
						color="text.secondary"
						sx={{ mt: -0.5, mb: 1, ml: 6 }}
					>
						仅用于调试
					</Typography>
				</FormGroup>
			</AccordionDetails>
		</Accordion>
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
	const [internalLogging, setInternalLogging] = useLocalStorage(
		STORE_KEY_INTERNAL_LOGGING_ENABLED,
		false,
	);

	const [resolution, setResolution] = useResolutionSetting();

	const newVersionInfo = useVersionCheck(GITHUB_REPO);
	const providerState = useInfoProvider(ncmVersion);
	const { provider, status, error } = providerState;

	useSmtcConnection(providerState, SMTCEnabled);

	useGlobalApi(provider);

	useEffect(() => {
		if (status === "ready" && provider) {
			const hasSupport = provider.adapter.hasNativeSmtcSupport();
			if (hasSupport) {
				logger.info("检测到内置的 SMTC 功能 (应该已禁用)", "Main");
			}
		}
	}, [status, provider]);

	useEffect(() => {
		if (provider) {
			provider.adapter.setInternalLogging(internalLogging);
		}
	}, [provider, internalLogging]);

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

	if (ncmVersion === null || status === "loading") {
		return <LoadingIndicator />;
	}

	if (ncmVersion === "unsupported") {
		return <UnsupportedVersionAlert />;
	}

	if (status === "error") {
		return <InitializationErrorAlert error={error} />;
	}

	return (
		<div>
			{newVersionInfo && <NewVersionAlert newVersionInfo={newVersionInfo} />}

			<Typography variant="h6" gutterBottom>
				InfLink-rs 设置
			</Typography>

			<SmtcSettings
				smtcEnabled={SMTCEnabled}
				onSmtcEnabledChange={setSMTCEnabled}
			/>

			<ResolutionSettings
				resolution={resolution}
				onResolutionChange={setResolution}
			/>

			<AdvancedSettings
				frontendLogLevel={frontendLogLevel}
				backendLogLevel={backendLogLevel}
				internalLogging={internalLogging}
				onFrontendLogLevelChange={setFrontendLogLevel}
				onBackendLogLevelChange={setBackendLogLevel}
				onInternalLoggingChange={setInternalLogging}
			/>
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
