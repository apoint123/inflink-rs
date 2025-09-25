/**
 * @fileoverview
 * 此处的脚本将会在插件管理器加载插件期间被加载
 * 一般情况下只需要从这个入口点进行开发即可满足绝大部分需求
 */
import {
	Alert,
	AlertTitle,
	FormControlLabel,
	FormGroup,
	Switch,
	Typography,
} from "@mui/material";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { useLocalStorage } from "./hooks";
import { STORE_KEY_SMTC_ENABLED } from "./keys";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import { ReactStoreProvider } from "./SongInfoProviders/ReactStoreProvider";

const configElement = document.createElement("div");

plugin.onLoad((selfPlugin) => {
	console.log("[InfLink] 插件正在加载...", selfPlugin);

	try {
		createRoot(configElement).render(<Main />);
		console.log("[InfLink] React 组件渲染成功");
	} catch (error) {
		console.error("[InfLink] React 组件渲染失败:", error);
	}
});

function Main() {
	const [isCompatible, setIsCompatible] = React.useState<boolean | null>(null);

	React.useEffect(() => {
		try {
			const version = betterncm.ncm.getNCMVersion();
			const majorVersion = parseInt(version.split(".")[0], 10);
			if (majorVersion >= 3) {
				setIsCompatible(true);
			} else {
				setIsCompatible(false);
			}
		} catch (e) {
			console.error("[InfLink] 无法检测网易云音乐版本。", e);
			setIsCompatible(false);
		}
	}, []);

	const [SMTCEnabled, setSMTCEnabled] = useLocalStorage(
		STORE_KEY_SMTC_ENABLED,
		true,
	);

	const [infoProvider, setInfoProvider] =
		React.useState<ReactStoreProvider | null>(null);

	React.useEffect(() => {
		if (isCompatible) {
			const provider = new ReactStoreProvider();
			setInfoProvider(provider);

			return () => {
				provider.disabled = true;
				provider.dispatchEvent(new CustomEvent("disable"));
				if ("dispose" in provider && typeof provider.dispose === "function") {
					provider.dispose();
				}
			};
		}
	}, [isCompatible]);

	// 设置 Provider 和 SMTC 后端之间的连接
	React.useEffect(() => {
		if (!infoProvider) {
			return;
		}

		const smtcImplObj = SMTCNativeBackendInstance;

		if (!SMTCEnabled) {
			smtcImplObj.disable();
			return;
		}

		const onUpdateSongInfo = (e: CustomEvent) => smtcImplObj.update(e.detail);
		const onUpdatePlayState = (e: CustomEvent) =>
			smtcImplObj.updatePlayState(e.detail === "Playing" ? 3 : 4);
		const onUpdateTimeline = (e: CustomEvent) =>
			smtcImplObj.updateTimeline(e.detail);

		infoProvider.addEventListener("updateSongInfo", onUpdateSongInfo);
		infoProvider.addEventListener("updatePlayState", onUpdatePlayState);
		infoProvider.addEventListener("updateTimeline", onUpdateTimeline);

		infoProvider.onPlayModeChange = (detail) => {
			smtcImplObj.updatePlayMode(detail);
		};

		smtcImplObj.apply(
			// 处理从后端来的控制命令
			(msg) => {
				infoProvider.dispatchEvent(new CustomEvent("control", { detail: msg }));
			},
			// 连接成功后执行的回调
			async () => {
				await infoProvider.ready;
				infoProvider.forceDispatchFullState();
			},
		);

		const cleanup = () => {
			console.log("[InfLink] 清理事件监听...");
			infoProvider.removeEventListener("updateSongInfo", onUpdateSongInfo);
			infoProvider.removeEventListener("updatePlayState", onUpdatePlayState);
			infoProvider.removeEventListener("updateTimeline", onUpdateTimeline);
			infoProvider.onPlayModeChange = null;
			smtcImplObj.disable();
		};

		return cleanup;
	}, [infoProvider, SMTCEnabled]);

	if (isCompatible === null) {
		return;
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
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
