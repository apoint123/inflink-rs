/**
 * @fileoverview
 * 一些辅助性的小组件
 */

import { Loader2 } from "lucide-react";
import { Alert } from "./Alert";
import styles from "./StatusComponents.module.css";

export function LoadingIndicator() {
	return (
		<div className={styles.loadingContainer}>
			<Loader2 className={styles.spinner} size={24} />
			<span className={styles.loadingText}>正在初始化...</span>
		</div>
	);
}

export function InitializationErrorAlert({ error }: { error: Error | null }) {
	return (
		<Alert severity="error" title="插件初始化失败">
			部分组件未能初始化, 请尝试重启网易云音乐, 或者打开控制台查看详细信息
			<br />
			错误信息: {error?.message || "未知错误"}
		</Alert>
	);
}
