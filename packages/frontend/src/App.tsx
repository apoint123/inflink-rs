/**
 * @fileoverview
 * 主要的业务逻辑组件
 */

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { Box, Typography } from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { Provider, useAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { FeatureSettings } from "./components/FeatureSettings";
import {
	InitializationErrorAlert,
	LoadingIndicator,
} from "./components/StatusComponents";
import { VersionWarningAlert } from "./components/VersionWarningAlert";
import {
	useBackendConnection,
	useGlobalApi,
	useInfoProvider,
	useNcmTheme,
	useNcmVersion,
	useVersionWarning,
} from "./hooks";
import { NativeBackendInstance } from "./services/NativeBackend";
import {
	backendLogLevelAtom,
	frontendLogLevelAtom,
	internalLoggingAtom,
	resolutionAtom,
} from "./store";
import logger, { setLogLevel } from "./utils/logger";

const inflinkEmotionCache = createCache({
	key: "inflink-rs",
});

export default function App() {
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
		<CacheProvider value={inflinkEmotionCache}>
			<Provider>
				<ThemeProvider theme={theme}>
					<Main />
				</ThemeProvider>
			</Provider>
		</CacheProvider>
	);
}

function Main() {
	const ncmVersion = useNcmVersion();
	const adapterState = useInfoProvider(ncmVersion);
	const { adapter, status, error } = adapterState;

	const [frontendLogLevel] = useAtom(frontendLogLevelAtom);
	const [backendLogLevel] = useAtom(backendLogLevelAtom);
	const [internalLogging] = useAtom(internalLoggingAtom);
	const [resolution] = useAtom(resolutionAtom);

	useBackendConnection(adapterState);
	useGlobalApi(adapter);

	const showVersionWarning = useVersionWarning(ncmVersion);

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
		NativeBackendInstance.setBackendLogLevel(backendLogLevel);
	}, [backendLogLevel]);

	useEffect(() => {
		if (adapter) {
			adapter.setResolution(resolution);
		}
	}, [adapter, resolution]);

	if (ncmVersion === null || status === "loading") {
		return <LoadingIndicator />;
	}

	if (status === "error") {
		return <InitializationErrorAlert error={error} />;
	}

	return (
		<Box sx={{ pb: 4, pt: 1 }}>
			<Typography variant="h5" sx={{ mb: 3, fontWeight: "bold" }}>
				InfLink-rs 设置
			</Typography>

			<VersionWarningAlert version={ncmVersion} show={showVersionWarning} />

			<FeatureSettings />

			<AdvancedSettings />
		</Box>
	);
}
