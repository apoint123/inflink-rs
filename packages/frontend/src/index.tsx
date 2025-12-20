/**
 * @fileoverview
 * InfLink-rs 插件的主入口文件
 */

import BugReportIcon from "@mui/icons-material/BugReport";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import HeadsetIcon from "@mui/icons-material/Headset";
import HighQualityIcon from "@mui/icons-material/HighQuality";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import StorageIcon from "@mui/icons-material/Storage";
import StyleIcon from "@mui/icons-material/Style";
import TerminalIcon from "@mui/icons-material/Terminal";
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
	Link,
	MenuItem,
	Paper,
	Select,
	Switch,
	TextField,
	Typography,
} from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useAtom } from "jotai";
import {
	type ReactNode,
	StrictMode,
	useEffect,
	useMemo,
	useState,
} from "react";
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

interface SettingItemProps {
	icon?: ReactNode;
	title: string;
	description?: ReactNode;
	action: ReactNode;
	visible?: boolean;
}

function SettingItem({
	icon,
	title,
	description,
	action,
	visible = true,
}: SettingItemProps) {
	if (!visible) return null;

	return (
		<Paper
			variant="outlined"
			sx={{
				p: 2,
				mb: 1.5,
				borderRadius: 3,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				borderColor: "rgba(0, 0, 0, 0.08)",
				backgroundColor: (theme) =>
					theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.05)" : "#fff",
			}}
		>
			{icon && (
				<Box
					sx={{
						mr: 2,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "text.secondary",
						p: 1,
					}}
				>
					{icon}
				</Box>
			)}

			<Box sx={{ mr: 2, flex: 1 }}>
				<Typography
					variant="subtitle1"
					sx={{ fontWeight: 500, fontSize: "0.95rem" }}
				>
					{title}
				</Typography>
				{description && (
					<Typography
						variant="body2"
						color="text.secondary"
						sx={{ fontSize: "0.85rem", mt: 0.5 }}
					>
						{description}
					</Typography>
				)}
			</Box>
			<Box
				sx={{
					minWidth: "auto",
					display: "flex",
					justifyContent: "flex-end",
					alignItems: "center",
				}}
			>
				{action}
			</Box>
		</Paper>
	);
}

function FeatureSettings() {
	const [smtcEnabled, setSmtcEnabled] = useAtom(smtcEnabledAtom);
	const [resolution, setResolution] = useAtom(resolutionAtom);

	const [discordEnabled, setDiscordEnabled] = useAtom(discordEnabledAtom);
	const [discordShowPaused, setDiscordShowPaused] = useAtom(
		discordShowPausedAtom,
	);
	const [discordDisplayMode, setDiscordDisplayMode] = useAtom(
		discordDisplayModeAtom,
	);

	const predefinedResolutions = ["300", "500", "1024", "max"];
	const handleResChange = (_event: unknown, newValue: string | null) => {
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			setResolution(newValue);
		}
	};
	const handleResBlur = (event: React.FocusEvent<HTMLInputElement>) => {
		const newValue = event.target.value;
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			setResolution(newValue);
		}
	};

	return (
		<Box sx={{ mt: 1 }}>
			<Typography
				variant="subtitle2"
				color="text.secondary"
				sx={{ mb: 1, ml: 1 }}
			>
				SMTC 设置
			</Typography>

			<SettingItem
				icon={<GraphicEqIcon />}
				title="启用 SMTC 集成"
				description={
					<span>
						<Link
							component="button"
							variant="body2"
							underline="hover"
							onClick={() => {
								betterncm.ncm.openUrl(
									"https://learn.microsoft.com/zh-cn/windows/uwp/audio-video-camera/integrate-with-systemmediatransportcontrols",
								);
							}}
							sx={{
								verticalAlign: "baseline",
								cursor: "pointer",
								fontSize: "inherit",
							}}
						>
							在微软文档中查看
						</Link>
					</span>
				}
				action={
					<Switch
						checked={smtcEnabled}
						onChange={(_e, checked) => setSmtcEnabled(checked)}
					/>
				}
			/>

			<SettingItem
				visible={smtcEnabled}
				icon={<HighQualityIcon />}
				title="封面分辨率"
				description="可让 Wallpaper 之类的软件显示更高清的封面，但可能会减缓切歌后 SMTC 的更新速度"
				action={
					<Autocomplete
						freeSolo
						value={resolution}
						options={predefinedResolutions}
						onChange={handleResChange}
						onBlur={handleResBlur}
						sx={{ width: 140 }}
						renderInput={(params) => (
							// @ts-expect-error MUI 自己的类型问题
							<TextField {...params} size="small" variant="outlined" />
						)}
					/>
				}
			/>

			<Typography
				variant="subtitle2"
				color="text.secondary"
				sx={{ mb: 1, ml: 1 }}
			>
				Discord Rich Presence 设置
			</Typography>

			<SettingItem
				icon={<HeadsetIcon />}
				title="启用 Discord RPC 集成"
				description="将当前播放的歌曲同步显示到 Discord 状态中"
				action={
					<Switch
						checked={discordEnabled}
						onChange={(_e, checked) => setDiscordEnabled(checked)}
					/>
				}
			/>

			<SettingItem
				visible={discordEnabled}
				icon={<PauseCircleIcon />}
				title="暂停时保持状态"
				description="暂停时保留 Discord 状态显示 (注：由于 Discord 的限制，已播放时间将变为 00:00)"
				action={
					<Switch
						checked={discordShowPaused}
						onChange={(_e, checked) => setDiscordShowPaused(checked)}
					/>
				}
			/>

			<SettingItem
				visible={discordEnabled}
				icon={<StyleIcon />}
				title="状态显示风格"
				description={<span>自定义 "Listening to" 后面的文本内容</span>}
				action={
					<FormControl size="small" sx={{ width: 140 }}>
						<Select
							value={discordDisplayMode}
							onChange={(e) => setDiscordDisplayMode(e.target.value)}
							variant="outlined"
						>
							<MenuItem value="Name">应用名称</MenuItem>
							<MenuItem value="State">歌手名</MenuItem>
							<MenuItem value="Details">歌曲名</MenuItem>
						</Select>
					</FormControl>
				}
			/>
		</Box>
	);
}

function AdvancedSettings() {
	const [frontendLogLevel, setFrontendLogLevel] = useAtom(frontendLogLevelAtom);
	const [backendLogLevel, setBackendLogLevel] = useAtom(backendLogLevelAtom);
	const [internalLogging, setInternalLogging] = useAtom(internalLoggingAtom);

	const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);

	const logLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error"];

	return (
		<Accordion
			expanded={isAdvancedExpanded}
			onChange={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
			elevation={0}
			disableGutters
			sx={{
				backgroundColor: "transparent",
				"&::before": { display: "none" },
				mt: 1,
			}}
		>
			<AccordionSummary
				expandIcon={<ExpandMoreIcon />}
				sx={{
					padding: 0,
					minHeight: 48,
					"& .MuiAccordionSummary-content": { margin: "12px 0" },
				}}
			>
				<Typography variant="subtitle2" color="text.secondary" sx={{ ml: 1 }}>
					高级选项
				</Typography>
			</AccordionSummary>
			<AccordionDetails sx={{ px: 0, py: 1 }}>
				<SettingItem
					icon={<TerminalIcon />}
					title="前端日志级别"
					action={
						<FormControl size="small" sx={{ width: 120 }}>
							<Select
								value={frontendLogLevel}
								onChange={(e) => setFrontendLogLevel(e.target.value)}
							>
								{logLevels.map((l) => (
									<MenuItem key={l} value={l}>
										{l}
									</MenuItem>
								))}
							</Select>
						</FormControl>
					}
				/>

				<SettingItem
					icon={<StorageIcon />}
					title="后端日志级别"
					action={
						<FormControl size="small" sx={{ width: 120 }}>
							<Select
								value={backendLogLevel}
								onChange={(e) => setBackendLogLevel(e.target.value)}
							>
								{logLevels.map((l) => (
									<MenuItem key={l} value={l}>
										{l}
									</MenuItem>
								))}
							</Select>
						</FormControl>
					}
				/>

				<SettingItem
					icon={<BugReportIcon />}
					title="内部日志转发"
					description="仅供调试"
					action={
						<Switch
							checked={internalLogging}
							onChange={(_e, checked) => setInternalLogging(checked)}
						/>
					}
				/>
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
		<Box sx={{ pb: 4, pt: 1 }}>
			{newVersionInfo && <NewVersionAlert newVersionInfo={newVersionInfo} />}

			<Typography variant="h5" sx={{ mb: 3, fontWeight: "bold" }}>
				InfLink-rs 设置
			</Typography>

			<FeatureSettings />

			<AdvancedSettings />
		</Box>
	);
}

plugin.onConfig(() => {
	return configElement;
});
