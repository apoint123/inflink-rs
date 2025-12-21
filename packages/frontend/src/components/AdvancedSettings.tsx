/**
 * @fileoverview
 * 高级设置部分的组件
 */

import { feature } from "bun:bundle";
import BugReportIcon from "@mui/icons-material/BugReport";
import StorageIcon from "@mui/icons-material/Storage";
import TerminalIcon from "@mui/icons-material/Terminal";
import {
	Box,
	FormControl,
	MenuItem,
	Select,
	Switch,
	Typography,
} from "@mui/material";
import { useAtom } from "jotai";
import {
	backendLogLevelAtom,
	frontendLogLevelAtom,
	internalLoggingAtom,
} from "../store";
import type { LogLevel } from "../utils/logger";
import { SettingItem } from "./SettingItem";

export function AdvancedSettings() {
	const [frontendLogLevel, setFrontendLogLevel] = useAtom(frontendLogLevelAtom);
	const [backendLogLevel, setBackendLogLevel] = useAtom(backendLogLevelAtom);
	const [internalLogging, setInternalLogging] = useAtom(internalLoggingAtom);

	const logLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error"];

	return (
		<Box sx={{ mt: 3 }}>
			<Typography
				variant="subtitle2"
				color="text.secondary"
				sx={{ mb: 1, ml: 1 }}
			>
				高级选项
			</Typography>

			<SettingItem
				icon={<TerminalIcon />}
				title="前端日志级别"
				action={
					<FormControl size="small" sx={{ width: 120 }}>
						<Select
							value={frontendLogLevel}
							onChange={(e) => setFrontendLogLevel(e.target.value)}
						>
							{logLevels.map((l) => (
								<MenuItem key={l} value={l}>
									{l}
								</MenuItem>
							))}
						</Select>
					</FormControl>
				}
			/>

			<SettingItem
				icon={<StorageIcon />}
				title="后端日志级别"
				action={
					<FormControl size="small" sx={{ width: 120 }}>
						<Select
							value={backendLogLevel}
							onChange={(e) => setBackendLogLevel(e.target.value)}
						>
							{logLevels.map((l) => (
								<MenuItem key={l} value={l}>
									{l}
								</MenuItem>
							))}
						</Select>
					</FormControl>
				}
			/>

			{feature("DEV") ? (
				<SettingItem
					icon={<BugReportIcon />}
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
		</Box>
	);
}
