/**
 * @fileoverview
 * 一些辅助性的小组件
 */

import {
	Alert,
	AlertTitle,
	Box,
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
			InfLink-rs 不支持当前版本的网易云音乐, 请尝试降级网易云音乐版本
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
