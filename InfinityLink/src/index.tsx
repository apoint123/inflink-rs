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
import { render } from "react-dom";

import "./index.scss";

import { useLocalStorage } from "./hooks";
import {
	STORE_KEY_DCRPC_ENABLED,
	STORE_KEY_INFO_PROVIDER,
	STORE_KEY_SMTC_ENABLED,
	STORE_KEY_SMTC_IMPL,
} from "./keys";
import { DCRPC } from "./Receivers/dc-rpc";
import { SMTCRustBackend } from "./Receivers/smtc-rust";
import type { BaseProvider } from "./SongInfoProviders/BaseProvider";
import { DOMProvider } from "./SongInfoProviders/DOMProvider";
import { NativeProvider } from "./SongInfoProviders/NativeProvider";
import { ReactStoreProvider } from "./SongInfoProviders/ReactStoreProvider";

const configElement = document.createElement("div");

plugin.onLoad((selfPlugin) => {
	console.log("[InfLink] 插件正在加载...", selfPlugin);
	console.log("[InfLink] 插件路径:", plugin.pluginPath);

	try {
		render(<Main />, configElement);
		console.log("[InfLink] React 组件渲染成功");
	} catch (error) {
		console.error("[InfLink] React 组件渲染失败:", error);
	}
});

function Main() {
	const [_smtcImpl, setSmtcImpl] = useLocalStorage<
		"native" | "frontend" | "rust"
	>(STORE_KEY_SMTC_IMPL, "rust");

	const [SMTCEnabled, setSMTCEnabled] = useLocalStorage(
		STORE_KEY_SMTC_ENABLED,
		true,
	);

	const [DCRPCEnabled, setDCRPCEnabled] = useLocalStorage(
		STORE_KEY_DCRPC_ENABLED,
		false,
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
		if (InfoProvider) {
			InfoProvider.disabled = true;
			InfoProvider.dispatchEvent(new CustomEvent("disable"));
			if (
				"dispose" in InfoProvider &&
				typeof InfoProvider.dispose === "function"
			) {
				InfoProvider.dispose();
			}
		}

		let provider: BaseProvider | null = null;
		if (infoProviderName === "dom") provider = new DOMProvider();
		if (infoProviderName === "native") provider = new NativeProvider();
		if (infoProviderName === "reactstore") provider = new ReactStoreProvider();

		setInfoProvider(provider);
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

	React.useEffect(() => {
		if (DCRPCEnabled) {
			DCRPC.apply();
		}
	}, [DCRPCEnabled]);

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
					<FormControlLabel value="dom" control={<Radio />} label="DOM" />
					<FormControlLabel
						value="native"
						control={<Radio />}
						label="原生 (3.0.0 不可用)"
					/>
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

					<FormControlLabel
						control={
							<Switch
								checked={DCRPCEnabled}
								onChange={(_e, checked) => setDCRPCEnabled(checked)}
							/>
						}
						label="开启 Discord RPC"
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
