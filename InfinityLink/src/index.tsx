/**
 * @fileoverview
 * InfLink-rs 插件的主入口文件
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
	Tooltip,
	Typography,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useAtom } from "jotai";
import { StrictMode, useEffect, useId, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	useBackendConnection,
	useGlobalApi,
	useInfoProvider,
	useNcmTheme,
	useNcmVersion,
	useVersionCheck,
} from "./hooks";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import {
	backendLogLevelAtom,
	discordDisplayModeAtom,
	discordEnabledAtom,
	discordShowPausedAtom,
	frontendLogLevelAtom,
	internalLoggingAtom,
	resolutionAtom,
	smtcEnabledAtom,
} from "./store";
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

function SmtcSettings() {
	const [smtcEnabled, setSmtcEnabled] = useAtom(smtcEnabledAtom);
	const [discordEnabled, setDiscordEnabled] = useAtom(discordEnabledAtom);
	const [discordShowPaused, setDiscordShowPaused] = useAtom(
		discordShowPausedAtom,
	);
	const [discordDisplayMode, setDiscordDisplayMode] = useAtom(
		discordDisplayModeAtom,
	);

	const displayModeId = useId();

	return (
		<>
			<Typography variant="h6" gutterBottom sx={{ mt: 2, fontSize: "1rem" }}>
				功能设置
			</Typography>
			<FormGroup sx={{ alignItems: "flex-start" }}>
				<FormControlLabel
					control={
						<Switch
							checked={smtcEnabled}
							onChange={(_e, checked) => setSmtcEnabled(checked)}
						/>
					}
					label="启用 SMTC"
				/>
				<FormControlLabel
					control={
						<Switch
							checked={discordEnabled}
							onChange={(_e, checked) => setDiscordEnabled(checked)}
						/>
					}
					label="启用 Discord RPC"
				/>

				{discordEnabled && (
					<Tooltip
						title={
							<>
								<Typography variant="body2">
									如果启用，则在暂停时也显示 Discord
									状态。如果不启用则在暂停时清除 Discord 状态
								</Typography>
								<br />
								<Typography variant="body2">
									注意：由于 Discord 的限制，已播放时间将变为 00:00
								</Typography>
							</>
						}
					>
						<FormControlLabel
							control={
								<Switch
									checked={discordShowPaused}
									onChange={(_e, checked) => setDiscordShowPaused(checked)}
								/>
							}
							label="暂停时显示 Discord 状态"
						/>
					</Tooltip>
				)}

				{discordEnabled && (
					<Tooltip
						placement="top-start"
						title={
							<Box sx={{ p: 0.5 }}>
								<Typography variant="body2" component="div">
									紧跟在 "Listening to" 之后的文本
								</Typography>
							</Box>
						}
					>
						<FormControl size="small" sx={{ mt: 2, ml: 0.5, minWidth: 200 }}>
							<InputLabel id={displayModeId}>状态显示选项</InputLabel>
							<Select
								labelId={displayModeId}
								value={discordDisplayMode}
								label="状态显示风格"
								onChange={(e) => setDiscordDisplayMode(e.target.value)}
							>
								<MenuItem value="Name">Netease CloudMusic</MenuItem>
								<MenuItem value="State">歌手名</MenuItem>
								<MenuItem value="Details">歌曲名</MenuItem>
							</Select>
						</FormControl>
					</Tooltip>
				)}
			</FormGroup>
		</>
	);
}

function ResolutionSettings() {
	const [resolution, setResolution] = useAtom(resolutionAtom);

	const predefinedResolutions = ["300", "500", "1024", "max"];

	const handleChange = (_event: unknown, newValue: string | null) => {
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			setResolution(newValue);
		}
	};

	const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
		const newValue = event.target.value;
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			setResolution(newValue);
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

function AdvancedSettings() {
	const [frontendLogLevel, setFrontendLogLevel] = useAtom(frontendLogLevelAtom);
	const [backendLogLevel, setBackendLogLevel] = useAtom(backendLogLevelAtom);
	const [internalLogging, setInternalLogging] = useAtom(internalLoggingAtom);
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
							onChange={(e) => setFrontendLogLevel(e.target.value)}
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
							onChange={(e) => setBackendLogLevel(e.target.value)}
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
								onChange={(_e, checked) => setInternalLogging(checked)}
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
	const newVersionInfo = useVersionCheck(GITHUB_REPO);
	const adapterState = useInfoProvider(ncmVersion);
	const { adapter, status, error } = adapterState;

	const [frontendLogLevel] = useAtom(frontendLogLevelAtom);
	const [backendLogLevel] = useAtom(backendLogLevelAtom);
	const [internalLogging] = useAtom(internalLoggingAtom);
	const [resolution] = useAtom(resolutionAtom);

	useBackendConnection(adapterState);
	useGlobalApi(adapter);

	useEffect(() => {
		if (status === "ready" && adapter) {
			const hasSupport = adapter.hasNativeSmtcSupport();
			if (hasSupport) {
				logger.info("检测到内置的 SMTC 功能 (应该已禁用)", "Main");
			}
		}
	}, [status, adapter]);

	useEffect(() => {
		if (adapter) {
			adapter.setInternalLogging(internalLogging);
		}
	}, [adapter, internalLogging]);

	useEffect(() => {
		setLogLevel(frontendLogLevel);
		logger.debug(`设置前端日志级别为: ${frontendLogLevel}`, "Main");
	}, [frontendLogLevel]);

	useEffect(() => {
		SMTCNativeBackendInstance.setBackendLogLevel(backendLogLevel);
	}, [backendLogLevel]);

	useEffect(() => {
		if (adapter) {
			adapter.setResolution(resolution);
		}
	}, [adapter, resolution]);

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

			<SmtcSettings />
			<ResolutionSettings />
			<AdvancedSettings />
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
