/**
 * @fileoverview
 * 一些辅助性的小组件
 */

import UpgradeIcon from "@mui/icons-material/Upgrade";
import {
	Alert,
	AlertTitle,
	Box,
	Button,
	CircularProgress,
	Typography,
} from "@mui/material";

export function LoadingIndicator() {
	return (
		<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
			<CircularProgress size={24} />
			<Typography variant="body2">正在初始化...</Typography>
		</Box>
	);
}

export function UnsupportedVersionAlert() {
	return (
		<Alert severity="error">
			<AlertTitle>不兼容的网易云音乐版本</AlertTitle>
			InfLink-rs 不支持当前版本的网易云音乐, 请使用原版 InfLink 作为代替
		</Alert>
	);
}

export function InitializationErrorAlert({ error }: { error: Error | null }) {
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

export function NewVersionAlert({ newVersionInfo }: NewVersionAlertProps) {
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
