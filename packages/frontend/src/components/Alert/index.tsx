import { AlertCircle, AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./index.module.css";

export interface AlertProps {
	severity?: "error" | "warning";
	title?: ReactNode;
	children: ReactNode;
	onClose?: () => void;
	className?: string;
}

export function Alert({
	severity = "warning",
	title,
	children,
	onClose,
	className = "",
}: AlertProps) {
	const isError = severity === "error";
	const alertClass = isError ? styles.error : styles.warning;
	const DefaultIcon = isError ? AlertCircle : AlertTriangle;

	return (
		<div className={`${styles.alert} ${alertClass} ${className}`}>
			<DefaultIcon className={styles.icon} size={22} strokeWidth={2} />

			<div className={styles.content}>
				{title && <h4 className={styles.title}>{title}</h4>}
				<div className={styles.body}>{children}</div>
			</div>

			{onClose && (
				<button
					type="button"
					className={styles.closeButton}
					onClick={onClose}
					title="关闭"
				>
					<X size={18} strokeWidth={2.5} />
				</button>
			)}
		</div>
	);
}
