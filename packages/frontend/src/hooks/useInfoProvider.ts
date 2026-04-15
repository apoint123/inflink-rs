import { useEffect, useState } from "react";
import type { INcmAdapter } from "@/adapters/adapter";
import { V2NcmAdapter } from "@/adapters/v2/adapter";
import { V3NcmAdapter } from "@/adapters/v3/adapter";
import logger from "@/utils/logger";
import type { NcmVersionInfo } from ".";

export interface AdapterState {
	adapter: INcmAdapter | null;
	status: "loading" | "ready" | "error";
	error: Error | null;
}

const INITIAL_ADAPTER_STATE: AdapterState = {
	adapter: null,
	status: "loading",
	error: null,
};

export function useInfoProvider(version: NcmVersionInfo | null): AdapterState {
	const [adapterState, setAdapterState] = useState<AdapterState>(
		INITIAL_ADAPTER_STATE,
	);

	useEffect(() => {
		let didUnmount = false;

		const initializeProvider = async () => {
			if (!version) {
				if (!didUnmount) {
					setAdapterState(INITIAL_ADAPTER_STATE);
				}
				return;
			}

			let adapter: INcmAdapter | null = null;
			switch (version.adapterVersion) {
				case "v3": {
					adapter = new V3NcmAdapter();
					break;
				}
				case "v2": {
					adapter = new V2NcmAdapter();
					break;
				}
			}

			if (adapter) {
				try {
					await adapter.initialize();
				} catch (e) {
					if (didUnmount) {
						return;
					}

					const error = e instanceof Error ? e : new Error(String(e));
					logger.error(`Adapter 初始化失败:`, "useInfoProvider", error);
					setAdapterState({
						adapter: null,
						status: "error",
						error: error,
					});
					return;
				}

				if (didUnmount) return;

				setAdapterState({
					adapter: adapter,
					status: "ready",
					error: null,
				});

				return () => {
					adapter?.dispose();
				};
			} else {
				if (!didUnmount) {
					setAdapterState(INITIAL_ADAPTER_STATE);
				}
				return;
			}
		};

		let cleanupProvider: (() => void) | undefined;
		initializeProvider().then((cleanup) => {
			if (typeof cleanup === "function") {
				cleanupProvider = cleanup;
			}
		});

		return () => {
			didUnmount = true;
			if (cleanupProvider) {
				cleanupProvider();
			}
		};
	}, [version]);

	return adapterState;
}
