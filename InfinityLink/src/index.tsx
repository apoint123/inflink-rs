/**
 * @fileoverview
 * 此处的脚本将会在插件管理器加载插件期间被加载
 * 一般情况下只需要从这个入口点进行开发即可满足绝大部分需求
 */
import {
	Alert,
	AlertTitle,
	CircularProgress,
	FormControlLabel,
	FormGroup,
	Link,
	Switch,
	Typography,
} from "@mui/material";
import { createRoot } from "react-dom/client";

import {
	useCompatibility,
	useInfoProvider,
	useLocalStorage,
	useSmtcConnection,
	useVersionCheck,
} from "./hooks";
import { STORE_KEY_SMTC_ENABLED } from "./keys";

const configElement = document.createElement("div");

plugin.onLoad((selfPlugin) => {
	console.log("[InfLink-rs] 插件正在加载...", selfPlugin);

	try {
		createRoot(configElement).render(<Main />);
	} catch (error) {
		console.error("[InfLink-rs] React 组件渲染失败:", error);
	}
});

function Main() {
	const isCompatible = useCompatibility();
	const [SMTCEnabled, setSMTCEnabled] = useLocalStorage(
		STORE_KEY_SMTC_ENABLED,
		true,
	);
	const newVersionInfo = useVersionCheck(GITHUB_REPO);
	const infoProvider = useInfoProvider(isCompatible);
	useSmtcConnection(infoProvider, SMTCEnabled);

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
					<AlertTitle>发现新版本: {newVersionInfo.version} </AlertTitle>
					下载新版本以获得最新功能和修复
					<Link
						onClick={() => betterncm.ncm.openUrl(newVersionInfo.url)}
						sx={{ ml: 1, fontWeight: "bold", cursor: "pointer" }}
					>
						前往下载
					</Link>
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
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
