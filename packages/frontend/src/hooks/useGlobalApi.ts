import { useEffect } from "react";
import type { INcmAdapter } from "../adapters/adapter";
import type { IInfLinkApi } from "../types/api";
import { handleAdapterCommand } from "./handleAdapterCommand";

export function useGlobalApi(adapter: INcmAdapter | null) {
	useEffect(() => {
		if (adapter) {
			const api: IInfLinkApi = {
				version: __APP_VERSION__,

				getCurrentSong: () => adapter.getCurrentSongInfo(),
				getPlaybackStatus: () => adapter.getPlaybackStatus(),
				getTimeline: () => adapter.getTimelineInfo(),
				getPlayMode: () => adapter.getPlayMode(),
				getVolume: () => adapter.getVolumeInfo(),

				play: () => handleAdapterCommand(adapter, { type: "Play" }),
				pause: () => handleAdapterCommand(adapter, { type: "Pause" }),
				stop: () => handleAdapterCommand(adapter, { type: "Stop" }),
				next: () => handleAdapterCommand(adapter, { type: "NextSong" }),
				previous: () => handleAdapterCommand(adapter, { type: "PreviousSong" }),
				seekTo: (pos) =>
					handleAdapterCommand(adapter, { type: "Seek", position_ms: pos }),
				toggleShuffle: () =>
					handleAdapterCommand(adapter, { type: "ToggleShuffle" }),
				toggleRepeat: () =>
					handleAdapterCommand(adapter, { type: "ToggleRepeat" }),
				setRepeatMode: (mode) =>
					handleAdapterCommand(adapter, { type: "SetRepeat", mode }),
				setVolume: (level) =>
					handleAdapterCommand(adapter, { type: "SetVolume", level }),
				toggleMute: () => handleAdapterCommand(adapter, { type: "ToggleMute" }),

				addEventListener: (type, listener) =>
					adapter.addEventListener(type, listener),
				removeEventListener: (type, listener) =>
					adapter.removeEventListener(type, listener),
			};

			window.InfLinkApi = api;

			return () => {
				delete window.InfLinkApi;
			};
		}
		return;
	}, [adapter]);
}
