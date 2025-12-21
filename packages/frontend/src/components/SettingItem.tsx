/**
 * @fileoverview
 * 通用的设置行组件
 */

import { Box, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";

export interface SettingItemProps {
	icon?: ReactNode;
	title: string;
	description?: ReactNode;
	action: ReactNode;
	visible?: boolean;
}

export function SettingItem({
	icon,
	title,
	description,
	action,
	visible = true,
}: SettingItemProps) {
	if (!visible) return null;

	return (
		<Paper
			variant="outlined"
			sx={{
				p: 2,
				mb: 1.5,
				borderRadius: 3,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				borderColor: "rgba(0, 0, 0, 0.08)",
				backgroundColor: (theme) =>
					theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.05)" : "#fff",
			}}
		>
			{icon && (
				<Box
					sx={{
						mr: 2,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "text.secondary",
						p: 1,
					}}
				>
					{icon}
				</Box>
			)}

			<Box sx={{ mr: 2, flex: 1 }}>
				<Typography
					variant="subtitle1"
					sx={{ fontWeight: 500, fontSize: "0.95rem" }}
				>
					{title}
				</Typography>
				{description && (
					<Typography
						variant="body2"
						color="text.secondary"
						sx={{ fontSize: "0.85rem", mt: 0.5 }}
					>
						{description}
					</Typography>
				)}
			</Box>
			<Box
				sx={{
					minWidth: "auto",
					display: "flex",
					justifyContent: "flex-end",
					alignItems: "center",
				}}
			>
				{action}
			</Box>
		</Paper>
	);
}
