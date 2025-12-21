/**
 * @fileoverview
 * SMTC 和 Discord 的设置
 */

import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import HeadsetIcon from "@mui/icons-material/Headset";
import HighQualityIcon from "@mui/icons-material/HighQuality";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import StyleIcon from "@mui/icons-material/Style";
import {
	Autocomplete,
	Box,
	FormControl,
	Link,
	MenuItem,
	Select,
	Switch,
	TextField,
	Typography,
} from "@mui/material";
import { useAtom } from "jotai";
import {
	discordDisplayModeAtom,
	discordEnabledAtom,
	discordShowPausedAtom,
	resolutionAtom,
	smtcEnabledAtom,
} from "../store";
import { SettingItem } from "./SettingItem";

export function FeatureSettings() {
	const [smtcEnabled, setSmtcEnabled] = useAtom(smtcEnabledAtom);
	const [resolution, setResolution] = useAtom(resolutionAtom);

	const [discordEnabled, setDiscordEnabled] = useAtom(discordEnabledAtom);
	const [discordShowPaused, setDiscordShowPaused] = useAtom(
		discordShowPausedAtom,
	);
	const [discordDisplayMode, setDiscordDisplayMode] = useAtom(
		discordDisplayModeAtom,
	);

	const predefinedResolutions = ["300", "500", "1024", "max"];
	const handleResChange = (_event: unknown, newValue: string | null) => {
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			setResolution(newValue);
		}
	};
	const handleResBlur = (event: React.FocusEvent<HTMLInputElement>) => {
		const newValue = event.target.value;
		if (
			newValue &&
			(newValue.toLowerCase() === "max" || /^\d+$/.test(newValue))
		) {
			setResolution(newValue);
		}
	};

	return (
		<Box sx={{ mt: 1 }}>
			<Typography
				variant="subtitle2"
				color="text.secondary"
				sx={{ mb: 1, ml: 1 }}
			>
				SMTC 设置
			</Typography>

			<SettingItem
				icon={<GraphicEqIcon />}
				title="启用 SMTC 集成"
				description={
					<span>
						<Link
							component="button"
							variant="body2"
							underline="hover"
							onClick={() => {
								betterncm.ncm.openUrl(
									"https://learn.microsoft.com/zh-cn/windows/uwp/audio-video-camera/integrate-with-systemmediatransportcontrols",
								);
							}}
							sx={{
								verticalAlign: "baseline",
								cursor: "pointer",
								fontSize: "inherit",
							}}
						>
							在微软文档中查看
						</Link>
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
				icon={<HighQualityIcon />}
				title="封面分辨率"
				description="可让 Wallpaper 之类的软件显示更高清的封面，但可能会减缓切歌后 SMTC 的更新速度"
				action={
					<Autocomplete
						freeSolo
						value={resolution}
						options={predefinedResolutions}
						onChange={handleResChange}
						onBlur={handleResBlur}
						sx={{ width: 140 }}
						renderInput={(params) => (
							// @ts-expect-error MUI 自己的类型问题
							<TextField {...params} size="small" variant="outlined" />
						)}
					/>
				}
			/>

			<Typography
				variant="subtitle2"
				color="text.secondary"
				sx={{ mt: 3, mb: 1, ml: 1 }}
			>
				Discord Rich Presence 设置
			</Typography>

			<SettingItem
				icon={<HeadsetIcon />}
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
				icon={<PauseCircleIcon />}
				title="暂停时保持状态"
				description="暂停时保留 Discord 状态显示 (注：由于 Discord 的限制，已播放时间将变为 00:00)"
				action={
					<Switch
						checked={discordShowPaused}
						onChange={(_e, checked) => setDiscordShowPaused(checked)}
					/>
				}
			/>

			<SettingItem
				visible={discordEnabled}
				icon={<StyleIcon />}
				title="状态显示风格"
				description={<span>自定义 "Listening to" 后面的文本内容</span>}
				action={
					<FormControl size="small" sx={{ width: 140 }}>
						<Select
							value={discordDisplayMode}
							onChange={(e) => setDiscordDisplayMode(e.target.value)}
							variant="outlined"
						>
							<MenuItem value="Name">应用名称</MenuItem>
							<MenuItem value="State">歌手名</MenuItem>
							<MenuItem value="Details">歌曲名</MenuItem>
						</Select>
					</FormControl>
				}
			/>
		</Box>
	);
}
