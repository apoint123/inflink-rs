import { Check, Copy, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { INcmAdapter } from "@/adapters/adapter";
import type { PaletteMode } from "@/hooks/useNcmTheme";
import type {
	PlaybackEventMap,
	PlaybackStatus,
	PlayMode,
	SongInfo,
	TimelineInfo,
	VolumeInfo,
} from "@/types/api";
import { copyTextToClipboard } from "@/utils/clipboard";
import styles from "./index.module.css";

interface DebugData {
	songInfo: SongInfo | null;
	playbackStatus: PlaybackStatus | null;
	timelineInfo: TimelineInfo | null;
	playMode: PlayMode | null;
	volumeInfo: VolumeInfo | null;
}

const INITIAL_DATA: DebugData = {
	songInfo: null,
	playbackStatus: null,
	timelineInfo: null,
	playMode: null,
	volumeInfo: null,
};

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 550;
const EDGE_MARGIN = 120;
const HEADER_MARGIN_BOTTOM = 40;

function useDebugData(adapter: INcmAdapter | null): DebugData {
	const [data, setData] = useState<DebugData>(INITIAL_DATA);

	useEffect(() => {
		if (!adapter) return;

		setData({
			songInfo: adapter.getCurrentSongInfo(),
			playbackStatus: adapter.getPlaybackStatus(),
			timelineInfo: adapter.getTimelineInfo(),
			playMode: adapter.getPlayMode(),
			volumeInfo: adapter.getVolumeInfo(),
		});

		const onSongChange = (e: PlaybackEventMap["songChange"]) =>
			setData((prev) => ({ ...prev, songInfo: e.detail }));
		const onPlayStateChange = (e: PlaybackEventMap["playStateChange"]) =>
			setData((prev) => ({ ...prev, playbackStatus: e.detail }));
		const onRawTimelineUpdate = (e: PlaybackEventMap["rawTimelineUpdate"]) =>
			setData((prev) => ({ ...prev, timelineInfo: e.detail }));
		const onPlayModeChange = (e: PlaybackEventMap["playModeChange"]) =>
			setData((prev) => ({ ...prev, playMode: e.detail }));
		const onVolumeChange = (e: PlaybackEventMap["volumeChange"]) =>
			setData((prev) => ({ ...prev, volumeInfo: e.detail }));

		adapter.addEventListener("songChange", onSongChange);
		adapter.addEventListener("playStateChange", onPlayStateChange);
		adapter.addEventListener("rawTimelineUpdate", onRawTimelineUpdate);
		adapter.addEventListener("playModeChange", onPlayModeChange);
		adapter.addEventListener("volumeChange", onVolumeChange);

		return () => {
			adapter.removeEventListener("songChange", onSongChange);
			adapter.removeEventListener("playStateChange", onPlayStateChange);
			adapter.removeEventListener("rawTimelineUpdate", onRawTimelineUpdate);
			adapter.removeEventListener("playModeChange", onPlayModeChange);
			adapter.removeEventListener("volumeChange", onVolumeChange);
		};
	}, [adapter]);

	return data;
}

function DebugSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className={styles.section}>
			<h4 className={styles.sectionTitle}>{title}</h4>
			<div className={styles.sectionBody}>{children}</div>
		</section>
	);
}

function DebugRow({
	label,
	value,
	mono = false,
}: {
	label: string;
	value: ReactNode;
	mono?: boolean;
}) {
	const valueRef = useRef<HTMLSpanElement>(null);
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		const text = valueRef.current?.textContent;
		if (!text) return;
		if (await copyTextToClipboard(text)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		}
	};

	return (
		<div className={styles.row}>
			<span className={styles.label}>{label}</span>
			{value == null ? (
				<span className={`${styles.value} ${styles.valueNull}`}>—</span>
			) : (
				<span
					ref={valueRef}
					className={`${styles.value} ${mono ? styles.valueMono : ""}`}
				>
					{value}
				</span>
			)}
			<button
				type="button"
				className={styles.copyButton}
				disabled={value == null}
				onClick={handleCopy}
				aria-label="复制"
				title="复制"
			>
				{copied ? <Check size={12} /> : <Copy size={12} />}
			</button>
		</div>
	);
}

function formatMs(ms: number | undefined) {
	if (ms === undefined) return null;
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, "0")} (${ms} ms)`;
}

export function DebugPanel({
	adapter,
	theme,
	onClose,
}: {
	adapter: INcmAdapter | null;
	theme: PaletteMode;
	onClose: () => void;
}) {
	const data = useDebugData(adapter);

	const panelRef = useRef<HTMLDivElement>(null);
	const dragStateRef = useRef<{
		pointerX: number;
		pointerY: number;
		left: number;
		top: number;
	} | null>(null);

	const [pos, setPos] = useState(() => ({
		left: Math.max(0, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2)),
		top: Math.max(0, Math.round((window.innerHeight - DEFAULT_HEIGHT) / 2)),
	}));

	const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		if (e.target instanceof Element && e.target.closest("button")) return;
		dragStateRef.current = {
			pointerX: e.clientX,
			pointerY: e.clientY,
			left: pos.left,
			top: pos.top,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const state = dragStateRef.current;
		if (!state) return;
		const width = panelRef.current?.offsetWidth ?? DEFAULT_WIDTH;
		const left = Math.min(
			Math.max(state.left + e.clientX - state.pointerX, EDGE_MARGIN - width),
			window.innerWidth - EDGE_MARGIN,
		);
		const top = Math.min(
			Math.max(state.top + e.clientY - state.pointerY, 0),
			Math.max(0, window.innerHeight - HEADER_MARGIN_BOTTOM),
		);
		setPos({ left, top });
	};

	const handleHeaderPointerUp = () => {
		dragStateRef.current = null;
	};

	return createPortal(
		<div
			ref={panelRef}
			data-theme={theme}
			className={styles.panel}
			style={{
				left: pos.left,
				top: pos.top,
				width: DEFAULT_WIDTH,
				height: DEFAULT_HEIGHT,
			}}
		>
			<div
				className={styles.header}
				onPointerDown={handleHeaderPointerDown}
				onPointerMove={handleHeaderPointerMove}
				onPointerUp={handleHeaderPointerUp}
				onPointerCancel={handleHeaderPointerUp}
			>
				<h4 className={styles.title}>调试面板</h4>
				<button
					type="button"
					className={styles.closeButton}
					onClick={onClose}
					aria-label="关闭"
				>
					<X size={16} />
				</button>
			</div>

			<div className={styles.content}>
				<DebugSection title="歌曲信息">
					<DebugRow label="歌曲名称" value={data.songInfo?.songName} />
					<DebugRow label="专辑名称" value={data.songInfo?.albumName} />
					<DebugRow label="艺术家" value={data.songInfo?.authorName} />
					<DebugRow label="歌曲 ID" value={data.songInfo?.ncmId} mono />
					<DebugRow
						label="总时长"
						value={formatMs(data.songInfo?.duration)}
						mono
					/>
				</DebugSection>

				<DebugSection title="播放状态">
					<DebugRow label="播放 / 暂停" value={data.playbackStatus} mono />
				</DebugSection>

				<DebugSection title="播放进度">
					<DebugRow
						label="当前时间"
						value={formatMs(data.timelineInfo?.currentTime)}
						mono
					/>
					<DebugRow
						label="总时长"
						value={formatMs(data.timelineInfo?.totalTime)}
						mono
					/>
				</DebugSection>

				<DebugSection title="播放模式">
					<DebugRow
						label="随机播放"
						value={
							data.playMode == null
								? null
								: data.playMode.isShuffling
									? "开启"
									: "关闭"
						}
					/>
					<DebugRow label="循环模式" value={data.playMode?.repeatMode} mono />
				</DebugSection>

				<DebugSection title="音量">
					<DebugRow
						label="音量"
						value={
							data.volumeInfo == null
								? null
								: `${Math.round(data.volumeInfo.volume * 100)}%`
						}
						mono
					/>
					<DebugRow
						label="静音"
						value={
							data.volumeInfo == null
								? null
								: data.volumeInfo.isMuted
									? "是"
									: "否"
						}
					/>
				</DebugSection>
			</div>
		</div>,
		document.body,
	);
}
