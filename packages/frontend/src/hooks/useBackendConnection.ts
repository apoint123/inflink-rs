import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { NativeBackendInstance } from "../services/NativeBackend";
import { appConfigAtom } from "../store";
import type { PlaybackEventMap } from "../types/api";
import type { ControlMessage } from "../types/backend";
import { handleAdapterCommand } from "./handleAdapterCommand";
import type { AdapterState } from "./useInfoProvider";

export function useBackendConnection(adapterState: AdapterState) {
	const { adapter, status } = adapterState;

	const config = useAtomValue(appConfigAtom);
	const {
		smtcEnabled,
		discordEnabled,
		discordShowPaused,
		discordDisplayMode,
		appNameMode,
	} = config;

	const hasSentInitialMetadata = useRef(false);

	const configRef = useRef(config);
	useEffect(() => {
		configRef.current = config;
	}, [config]);

	const shouldConnect =
		status === "ready" && adapter && (smtcEnabled || discordEnabled);

	useEffect(() => {
		if (!shouldConnect || !adapter) {
			NativeBackendInstance.disable();
			hasSentInitialMetadata.current = false;
			return;
		}

		const nativeBackend = NativeBackendInstance;

		const onSongChange = async (e: PlaybackEventMap["songChange"]) => {
			await nativeBackend.update(e.detail);
			if (!hasSentInitialMetadata.current) {
				hasSentInitialMetadata.current = true;
				if (configRef.current.smtcEnabled) {
					nativeBackend.enableSmtcSession();
				}
			}
		};
		const onPlayStateChange = (e: PlaybackEventMap["playStateChange"]) =>
			nativeBackend.updatePlayState(e.detail);
		const onTimelineUpdate = (e: PlaybackEventMap["timelineUpdate"]) =>
			nativeBackend.updateTimeline(e.detail);
		const onPlayModeChange = (e: PlaybackEventMap["playModeChange"]) =>
			nativeBackend.updatePlayMode(e.detail);

		const onControl = (msg: ControlMessage) => {
			handleAdapterCommand(adapter, msg);
		};

		adapter.addEventListener("songChange", onSongChange);
		adapter.addEventListener("playStateChange", onPlayStateChange);
		adapter.addEventListener("timelineUpdate", onTimelineUpdate);
		adapter.addEventListener("playModeChange", onPlayModeChange);

		nativeBackend.initialize(onControl);

		return () => {
			adapter.removeEventListener("songChange", onSongChange);
			adapter.removeEventListener("playStateChange", onPlayStateChange);
			adapter.removeEventListener("timelineUpdate", onTimelineUpdate);
			adapter.removeEventListener("playModeChange", onPlayModeChange);
			nativeBackend.disable();
			hasSentInitialMetadata.current = false;
		};
	}, [shouldConnect, adapter]);

	useEffect(() => {
		if (!shouldConnect) return;

		const nativeBackend = NativeBackendInstance;

		if (smtcEnabled) {
			nativeBackend.enableSmtcSession();
		} else {
			nativeBackend.disableSmtcSession();
		}

		if (discordEnabled) {
			nativeBackend.enableDiscordRpc();
		} else {
			nativeBackend.disableDiscordRpc();
		}

		nativeBackend.updateDiscordConfig({
			showWhenPaused: discordShowPaused,
			displayMode: discordDisplayMode,
			appNameMode: appNameMode,
		});
	}, [
		shouldConnect,
		smtcEnabled,
		discordEnabled,
		discordShowPaused,
		discordDisplayMode,
		appNameMode,
	]);
}
