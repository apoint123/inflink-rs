/**
 * @fileoverview 通用的设置行组件
 */

import type { ReactNode } from "react";
import styles from "./index.module.css";

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
		<div className={styles.paper}>
			{icon && <div className={styles.iconWrapper}>{icon}</div>}

			<div className={styles.textWrapper}>
				<h4 className={styles.title}>{title}</h4>
				{description && <p className={styles.description}>{description}</p>}
			</div>

			<div className={styles.actionWrapper}>{action}</div>
		</div>
	);
}
