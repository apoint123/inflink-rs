import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { NativeBackendInstance } from "../services/NativeBackend";
import { appConfigAtom } from "../store";
import type { PlaybackEventMap, SongInfo } from "../types/api";
import type { ControlMessage } from "../types/backend";
import { isSameSong } from "../utils";
import logger from "../utils/logger";
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

	// 前端持有的 SMTC 可见性镜像: 发出 EnableSmtc 后为 true, Disable 后为 false。
	// 后端是纯转发的中间人, "卡片何时亮起"完全由这里决定。
	const smtcActiveRef = useRef(false);
	// 最近一次确认送达后端的歌曲。会话常驻, 其中的元数据始终对应这个值;
	// 与 adapter 当前歌不一致时, 上线前需要补发元数据。
	const deliveredSongRef = useRef<SongInfo | null>(null);

	const configRef = useRef(config);
	useEffect(() => {
		configRef.current = config;
	}, [config]);

	const shouldConnect =
		status === "ready" && adapter && (smtcEnabled || discordEnabled);

	// 全项目唯一发出 EnableSmtc 的地方。
	// 调用方必须保证此刻会话里已有当前歌的元数据 (刚送达或此前已送达),
	// 否则系统媒体浮层会亮出一张没有歌名与封面的空白卡片。
	const activateSmtcIfNeeded = useCallback(() => {
		if (!configRef.current.smtcEnabled || smtcActiveRef.current) return;
		smtcActiveRef.current = true;
		NativeBackendInstance.enableSmtcSession();
	}, []);

	useEffect(() => {
		if (!adapter) {
			return;
		}

		const nativeBackend = NativeBackendInstance;

		const onSongChange = async (e: PlaybackEventMap["songChange"]) => {
			const delivered = await nativeBackend.update(e.detail);
			if (!delivered) return;
			deliveredSongRef.current = e.detail;
			activateSmtcIfNeeded();
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

		// 播放事件始终上报（不随 shouldConnect 断开）：后端与 SMTC 会话随页面
		// 常驻, 两个功能都关闭时隐藏的会话也要持续跟进当前播放, 重新开启时才
		// 能立即显示当前歌曲。
		adapter.addEventListener("songChange", onSongChange);
		adapter.addEventListener("playStateChange", onPlayStateChange);
		adapter.addEventListener("timelineUpdate", onTimelineUpdate);
		adapter.addEventListener("playModeChange", onPlayModeChange);

		// 后端随页面常驻: 无论功能开关与否都初始化。dispatcher 空闲时转发成本
		// 可忽略, Discord 线程未启用时不建立连接; 只有这样, 双关期间隐藏的会话
		// 才能持续跟进当前播放, "会话常驻"的前提才对从未启用过的用户也成立。
		nativeBackend.initialize(onControl);

		return () => {
			adapter.removeEventListener("songChange", onSongChange);
			adapter.removeEventListener("playStateChange", onPlayStateChange);
			adapter.removeEventListener("timelineUpdate", onTimelineUpdate);
			adapter.removeEventListener("playModeChange", onPlayModeChange);
		};
	}, [adapter, activateSmtcIfNeeded]);

	useEffect(() => {
		const nativeBackend = NativeBackendInstance;

		if (!shouldConnect) {
			smtcActiveRef.current = false;
			nativeBackend.disableSmtcSession();
			nativeBackend.disableDiscordRpc();
			return;
		}

		if (smtcEnabled) {
			// 开启 SMTC（启动即启用与手动开关共用此路径）：
			// - 会话里已有当前歌的元数据 → 直接上线
			// - 没有送达记录（如歌曲恢复早于监听器挂载的竞态）→ 先补发再上线
			// - 歌曲尚未恢复 → 不开, 交给恢复后的 songChange 自动上线
			void (async () => {
				try {
					if (!adapter) return;
					const info = adapter.getCurrentSongInfo();
					if (!info) return;

					if (!isSameSong(deliveredSongRef.current, info)) {
						const resolved = await adapter.getResolvedCurrentSongInfo();
						if (!resolved) return;
						if (!(await nativeBackend.update(resolved))) return;
						deliveredSongRef.current = resolved;
					}
					activateSmtcIfNeeded();
				} catch (e) {
					logger.error(
						`开启 SMTC 时发生错误: ${(e as Error).message}`,
						"useBackendConnection",
					);
				}
			})();
		} else {
			smtcActiveRef.current = false;
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
		adapter,
		activateSmtcIfNeeded,
	]);
}
