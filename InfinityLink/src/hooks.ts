import { useEffect, useState } from "react";
import { SMTCNativeBackendInstance } from "./Receivers/smtc-rust";
import { ReactStoreProvider } from "./SongInfoProviders/ReactStoreProvider";
import type { ControlMessage } from "./types/smtc";

export function useLocalStorage<T>(
	key: string,
	initialValue: T,
	parse: (string: string) => T = JSON.parse,
	stringify: (value: T) => string = JSON.stringify,
): [T, (value: T | ((prevValue: T) => T)) => void] {
	const [storedValue, setStoredValue] = useState(() => {
		try {
			const item = window.localStorage.getItem(key);
			return item ? parse(item) : initialValue;
		} catch (error) {
			console.log(error);
			return initialValue;
		}
	});

	const setValue = (value: T | ((prevValue: T) => T)) => {
		try {
			const valueToStore =
				value instanceof Function ? value(storedValue) : value;
			setStoredValue(valueToStore);
			window.localStorage.setItem(key, stringify(valueToStore));
		} catch (error) {
			console.log(error);
		}
	};

	return [storedValue, setValue];
}

export function useCompatibility(): boolean | null {
	const [isCompatible, setIsCompatible] = useState<boolean | null>(null);

	useEffect(() => {
		try {
			const version = betterncm.ncm.getNCMVersion();
			const majorVersion = parseInt(version.split(".")[0], 10);
			setIsCompatible(majorVersion >= 3);
		} catch (e) {
			console.error("[InfLink-rs] 无法检测网易云音乐版本。", e);
			setIsCompatible(false);
		}
	}, []);

	return isCompatible;
}

export function useInfoProvider(
	isCompatible: boolean | null,
): ReactStoreProvider | null {
	const [infoProvider, setInfoProvider] = useState<ReactStoreProvider | null>(
		null,
	);

	useEffect(() => {
		if (isCompatible) {
			const provider = new ReactStoreProvider();
			setInfoProvider(provider);

			return () => {
				provider.disabled = true;
				provider.dispatchEvent(new CustomEvent("disable"));
				if ("dispose" in provider && typeof provider.dispose === "function") {
					provider.dispose();
				}
				setInfoProvider(null);
			};
		}
	}, [isCompatible]);

	return infoProvider;
}

export function useSmtcConnection(
	infoProvider: ReactStoreProvider | null,
	isEnabled: boolean,
) {
	useEffect(() => {
		if (!infoProvider) {
			return;
		}

		const smtcImplObj = SMTCNativeBackendInstance;

		if (!isEnabled) {
			smtcImplObj.disable();
			return;
		}

		const onUpdateSongInfo = (e: CustomEvent) => smtcImplObj.update(e.detail);
		const onUpdatePlayState = (e: CustomEvent) => {
			const status = e.detail === "Playing" ? "Playing" : "Paused";
			smtcImplObj.updatePlayState(status);
		};

		const onUpdateTimeline = (e: CustomEvent) =>
			smtcImplObj.updateTimeline(e.detail);

		const onControl = (msg: ControlMessage) => {
			infoProvider.dispatchEvent(new CustomEvent("control", { detail: msg }));
		};

		infoProvider.addEventListener("updateSongInfo", onUpdateSongInfo);
		infoProvider.addEventListener("updatePlayState", onUpdatePlayState);
		infoProvider.addEventListener("updateTimeline", onUpdateTimeline);
		infoProvider.onPlayModeChange = (detail) => {
			smtcImplObj.updatePlayMode(detail);
		};

		const connectCallback = async () => {
			await infoProvider.ready;
			infoProvider.forceDispatchFullState();
		};

		smtcImplObj.initialize(onControl, connectCallback);

		return () => {
			console.log("[InfLink-rs] 清理事件监听...");
			infoProvider.removeEventListener("updateSongInfo", onUpdateSongInfo);
			infoProvider.removeEventListener("updatePlayState", onUpdatePlayState);
			infoProvider.removeEventListener("updateTimeline", onUpdateTimeline);
			infoProvider.onPlayModeChange = null;
			smtcImplObj.disable();
		};
	}, [infoProvider, isEnabled]);
}

export interface NewVersionInfo {
	version: string;
	url: string;
}

export function useVersionCheck(repo: string): NewVersionInfo | null {
	const [newVersionInfo, setNewVersionInfo] = useState<NewVersionInfo | null>(
		null,
	);

	useEffect(() => {
		const checkVersion = async () => {
			try {
				const res = await fetch(
					`https://api.github.com/repos/${repo}/releases/latest`,
				);
				if (!res.ok) {
					throw new Error(`GitHub API 请求失败, 错误码: ${res.status}`);
				}
				const latestRelease = await res.json();
				const latestVersion = latestRelease.tag_name.replace(/^v/, "");
				const currentVersion = __APP_VERSION__;

				if (
					latestVersion.localeCompare(currentVersion, undefined, {
						numeric: true,
					}) > 0
				) {
					console.log(`[InfLink-rs] 发现新版本: ${latestRelease.tag_name}`);
					setNewVersionInfo({
						version: latestRelease.tag_name,
						url: latestRelease.html_url,
					});
				} else {
					console.log("[InfLink-rs] 当前已是最新版本。");
				}
			} catch (error) {
				console.error("[InfLink-rs] 检查更新失败:", error);
			}
		};

		checkVersion();
	}, [repo]);

	return newVersionInfo;
}
