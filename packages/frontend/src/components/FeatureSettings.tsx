/**
 * @fileoverview
 * SMTC 和 Discord 的设置
 */

import { useAtom } from "jotai";
import {
	AudioLines,
	Bug,
	Database,
	Edit,
	ExternalLink,
	Headset,
	MonitorPlay,
	Palette,
	PauseCircle,
	Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DiscordDisplayMode } from "@/types/backend";
import {
	backendLogLevelAtom,
	discordAppNameModeTypeAtom,
	discordCustomAppNameTextAtom,
	discordDisplayModeAtom,
	discordEnabledAtom,
	discordShowPausedAtom,
	frontendLogLevelAtom,
	internalLoggingAtom,
	resolutionAtom,
	smtcEnabledAtom,
} from "../store";
import type { LogLevel } from "../utils/logger";
import { AnimatedLink } from "./AnimatedLink";
import { Combobox } from "./Combobox";
import styles from "./FeatureSettings.module.css";
import { Input } from "./Input";
import { SettingItem } from "./SettingItem";
import { Switch } from "./Switch";

export function FeatureSettings() {
	const [smtcEnabled, setSmtcEnabled] = useAtom(smtcEnabledAtom);
	const [resolution, setResolution] = useAtom(resolutionAtom);
	const [localResolution, setLocalResolution] = useState(resolution);

	const [discordEnabled, setDiscordEnabled] = useAtom(discordEnabledAtom);
	const [discordShowPaused, setDiscordShowPaused] = useAtom(
		discordShowPausedAtom,
	);
	const [discordDisplayMode, setDiscordDisplayMode] = useAtom(
		discordDisplayModeAtom,
	);
	const [appNameModeType, setAppNameModeType] = useAtom(
		discordAppNameModeTypeAtom,
	);
	const [customAppNameText, setCustomAppNameText] = useAtom(
		discordCustomAppNameTextAtom,
	);

	const [localCustomText, setLocalCustomText] = useState(customAppNameText);

	const [frontendLogLevel, setFrontendLogLevel] = useAtom(frontendLogLevelAtom);
	const [backendLogLevel, setBackendLogLevel] = useAtom(backendLogLevelAtom);
	const [internalLogging, setInternalLogging] = useAtom(internalLoggingAtom);

	const logLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error"];
	const logLevelOptions = logLevels.map((level) => ({
		label: level,
		value: level,
	}));

	useEffect(() => {
		setLocalCustomText(customAppNameText);
	}, [customAppNameText]);

	useEffect(() => {
		setLocalResolution(resolution);
	}, [resolution]);

	const handleCustomTextCommit = () => {
		if (localCustomText !== customAppNameText) {
			setCustomAppNameText(localCustomText);
		}
	};

	const handleCustomTextKeyDown = (
		e: React.KeyboardEvent<HTMLInputElement>,
	) => {
		if (e.key === "Enter") {
			handleCustomTextCommit();
			if (e.target instanceof HTMLElement) {
				e.target.blur();
			}
		}
	};

	const handleResCommit = () => {
		const val = localResolution.trim();
		if (val && (val.toLowerCase() === "max" || /^\d+$/.test(val))) {
			setResolution(val.toLowerCase());
		} else {
			setLocalResolution(resolution);
		}
	};

	const resolutionOptions = [
		{ label: "300", value: "300" },
		{ label: "500", value: "500" },
		{ label: "1024", value: "1024" },
		{ label: "max", value: "max" },
	];

	const displayModeOptions = [
		{ label: "应用名称", value: "Name" },
		{ label: "歌手名", value: "State" },
		{ label: "歌曲名", value: "Details" },
	];

	const appNameModeOptions = [
		{ label: "应用名称", value: "Default" },
		{ label: "歌曲名", value: "Song" },
		{ label: "歌手名", value: "Artist" },
		{ label: "专辑名", value: "Album" },
		{ label: "自定义文本", value: "Custom" },
	];

	return (
		<div className={styles.sectionContainerSmall}>
			<h3 className={styles.sectionTitle}>SMTC 设置</h3>

			<SettingItem
				icon={<AudioLines size={20} />}
				title="启用 SMTC 集成"
				description={
					<span>
						<AnimatedLink
							onClick={() => {
								betterncm.ncm.openUrl(
									"https://learn.microsoft.com/zh-cn/windows/uwp/audio-video-camera/integrate-with-systemmediatransportcontrols",
								);
							}}
							icon={<ExternalLink size={14} strokeWidth={2.5} />}
						>
							在微软文档中查看
						</AnimatedLink>
					</span>
				}
				action={
					<Switch
						checked={smtcEnabled}
						onChange={(_e, checked) => setSmtcEnabled(checked)}
					/>
				}
			/>

			<SettingItem
				visible={smtcEnabled}
				icon={<MonitorPlay size={20} />}
				title="封面分辨率"
				description="较高的分辨率可能会降低信息更新速度"
				action={
					<Combobox
						options={resolutionOptions}
						value={localResolution}
						onChange={setLocalResolution}
						onBlur={handleResCommit}
						allowCustomValue={true}
					/>
				}
			/>

			<h3 className={`${styles.sectionTitle} ${styles.sectionContainer}`}>
				Discord Rich Presence 设置
			</h3>

			<SettingItem
				icon={<Headset size={20} />}
				title="启用 Discord RPC 集成"
				description="将当前播放的歌曲同步显示到 Discord 状态中"
				action={
					<Switch
						checked={discordEnabled}
						onChange={(_e, checked) => setDiscordEnabled(checked)}
					/>
				}
			/>

			<SettingItem
				visible={discordEnabled}
				icon={<PauseCircle size={20} />}
				title="暂停时显示状态"
				description={
					<span>
						暂停时保留 Discord 状态的显示
						<br />
						注：由于 Discord 的限制，已播放时间将变为 00:00
					</span>
				}
				action={
					<Switch
						checked={discordShowPaused}
						onChange={(_e, checked) => setDiscordShowPaused(checked)}
					/>
				}
			/>

			<SettingItem
				visible={discordEnabled}
				icon={<Palette size={20} />}
				title="简略信息"
				description="向其他人展示的简略信息"
				action={
					<Combobox
						options={displayModeOptions}
						value={discordDisplayMode}
						onChange={(val) => setDiscordDisplayMode(val as DiscordDisplayMode)}
						editable={false}
					/>
				}
			/>

			<SettingItem
				visible={discordEnabled}
				icon={<Edit size={20} />}
				title="自定义应用名称"
				description={
					<span>
						会显示在 “Listening to” 后面
						<br />
						如果在 “简略信息” 设置中选择了 “应用名称”，简略信息也会显示此名称
					</span>
				}
				action={
					<div className={styles.flexRow}>
						<Combobox
							options={appNameModeOptions}
							value={appNameModeType}
							onChange={(val) =>
								setAppNameModeType(
									val as "Default" | "Song" | "Artist" | "Album" | "Custom",
								)
							}
							editable={false}
						/>
						{appNameModeType === "Custom" && (
							<Input
								style={{ width: 140 }}
								placeholder="自定义名称..."
								value={localCustomText}
								onChange={(e) => setLocalCustomText(e.target.value)}
								onBlur={handleCustomTextCommit}
								onKeyDown={handleCustomTextKeyDown}
							/>
						)}
					</div>
				}
			/>

			<h3 className={styles.sectionTitle}>高级选项</h3>

			<SettingItem
				icon={<Terminal size={20} />}
				title="前端日志级别"
				action={
					<Combobox
						options={logLevelOptions}
						value={frontendLogLevel}
						onChange={(val) => setFrontendLogLevel(val as LogLevel)}
						editable={false}
					/>
				}
			/>

			<SettingItem
				icon={<Database size={20} />}
				title="后端日志级别"
				action={
					<Combobox
						options={logLevelOptions}
						value={backendLogLevel}
						onChange={(val) => setBackendLogLevel(val as LogLevel)}
						editable={false}
					/>
				}
			/>

			{import.meta.env.DEV ? (
				<SettingItem
					icon={<Bug size={20} />}
					title="内部日志转发"
					description="仅供调试"
					action={
						<Switch
							checked={internalLogging}
							onChange={(_e, checked) => setInternalLogging(checked)}
						/>
					}
				/>
			) : null}
		</div>
	);
}
