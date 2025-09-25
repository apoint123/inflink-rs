/**
 * @fileoverview
 * 此处的脚本将会在插件管理器加载插件期间被加载
 * 一般情况下只需要从这个入口点进行开发即可满足绝大部分需求
 */
import {
	FormControlLabel,
	FormGroup,
	FormLabel,
	Radio,
	RadioGroup,
	Switch,
} from "@mui/material";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { useLocalStorage } from "./hooks";
import {
	STORE_KEY_INFO_PROVIDER,
	STORE_KEY_SMTC_ENABLED,
	STORE_KEY_SMTC_IMPL,
} from "./keys";
import { SMTCRustBackend } from "./Receivers/smtc-rust";
import type { BaseProvider } from "./SongInfoProviders/BaseProvider";
import { ReactStoreProvider } from "./SongInfoProviders/ReactStoreProvider";

const configElement = document.createElement("div");

plugin.onLoad((selfPlugin) => {
	console.log("[InfLink] 插件正在加载...", selfPlugin);
	console.log("[InfLink] 插件路径:", plugin.pluginPath);

	try {
		createRoot(configElement).render(<Main />);
		console.log("[InfLink] React 组件渲染成功");
	} catch (error) {
		console.error("[InfLink] React 组件渲染失败:", error);
	}
});

function Main() {
	const [_smtcImpl, setSmtcImpl] = useLocalStorage<"rust">(
		STORE_KEY_SMTC_IMPL,
		"rust",
	);

	const [SMTCEnabled, setSMTCEnabled] = useLocalStorage(
		STORE_KEY_SMTC_ENABLED,
		true,
	);

	const [infoProviderName, setInfoProviderName] = useLocalStorage(
		STORE_KEY_INFO_PROVIDER,
		"reactstore",
	);

	const [InfoProvider, setInfoProvider] = React.useState<BaseProvider | null>(
		null,
	);

	const smtcImplObj = SMTCRustBackend;

	React.useEffect(() => {
		let provider: BaseProvider | null = null;
		if (infoProviderName === "reactstore") {
			provider = new ReactStoreProvider();
		}

		setInfoProvider(provider);

		return () => {
			if (provider) {
				provider.disabled = true;
				provider.dispatchEvent(new CustomEvent("disable"));
				if ("dispose" in provider && typeof provider.dispose === "function") {
					provider.dispose();
				}
			}
		};
	}, [infoProviderName]);

	React.useEffect(() => {
		if (!InfoProvider) {
			return;
		}

		let cleanup = () => {};

		const setupConnections = async () => {
			if (!SMTCEnabled) {
				SMTCRustBackend.disable();
				return;
			}

			if (InfoProvider instanceof ReactStoreProvider) {
				console.log("[InfLink] 等待 ReactStoreProvider 就绪...");
				await InfoProvider.ready;
			}

			const onUpdateSongInfo = (e: CustomEvent) => smtcImplObj.update(e.detail);
			const onUpdatePlayState = (e: CustomEvent) =>
				smtcImplObj.updatePlayState(e.detail === "Playing" ? 3 : 4);
			const onUpdateTimeline = (e: CustomEvent) =>
				smtcImplObj.updateTimeline(e.detail);

			InfoProvider.addEventListener("updateSongInfo", onUpdateSongInfo);
			InfoProvider.addEventListener("updatePlayState", onUpdatePlayState);
			InfoProvider.addEventListener("updateTimeline", onUpdateTimeline);

			if (InfoProvider instanceof ReactStoreProvider) {
				InfoProvider.onPlayModeChange = (detail) => {
					smtcImplObj.updatePlayMode(detail);
				};
			}

			smtcImplObj.apply(
				// 处理从后端来的控制命令
				(msg) => {
					InfoProvider.dispatchEvent(
						new CustomEvent("control", { detail: msg }),
					);
				},
				// 连接成功后执行的回调
				() => {
					if (InfoProvider instanceof ReactStoreProvider) {
						InfoProvider.forceDispatchFullState();
					}
				},
			);

			if (InfoProvider instanceof ReactStoreProvider) {
				InfoProvider.forceDispatchFullState();
			}

			cleanup = () => {
				console.log("[InfLink] 清理连接和事件监听...");
				InfoProvider.removeEventListener("updateSongInfo", onUpdateSongInfo);
				InfoProvider.removeEventListener("updatePlayState", onUpdatePlayState);
				InfoProvider.removeEventListener("updateTimeline", onUpdateTimeline);
				if (InfoProvider instanceof ReactStoreProvider) {
					InfoProvider.onPlayModeChange = null;
				}
				smtcImplObj.disable();
			};
		};

		setupConnections();

		return () => {
			cleanup();
		};
	}, [InfoProvider, SMTCEnabled, smtcImplObj]);

	return (
		<div>
			<FormGroup>
				<FormLabel>信息源</FormLabel>
				<RadioGroup
					row
					defaultValue={infoProviderName}
					onChange={(_, v) => setInfoProviderName(v)}
					name="infoprovider"
				>
					<FormControlLabel
						value="reactstore"
						control={<Radio />}
						label="React Store"
					/>
				</RadioGroup>

				<div>
					<FormControlLabel
						control={
							<Switch
								checked={SMTCEnabled}
								onChange={(_e, checked) => setSMTCEnabled(checked)}
							/>
						}
						label="开启 SMTC"
					/>
				</div>

				{SMTCEnabled ? (
					<div>
						<FormLabel>SMTC 实现</FormLabel>
						<RadioGroup
							row
							value="rust"
							onChange={(_, _v) => setSmtcImpl("rust")}
							name="smtcImpl"
						>
							<FormControlLabel value="rust" control={<Radio />} label="Rust" />
						</RadioGroup>
					</div>
				) : null}
			</FormGroup>
		</div>
	);
}

plugin.onConfig(() => {
	return configElement;
});
