import { ArrowRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import styles from "./index.module.css";

export interface AnimatedLinkProps {
	children: ReactNode;
	onClick?: (e: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
	href?: string;
	className?: string;
	icon?: ReactNode;
}

export function AnimatedLink({
	children,
	onClick,
	href,
	className = "",
	icon = <ArrowRight size={16} strokeWidth={2.5} />,
}: AnimatedLinkProps) {
	if (href) {
		return (
			<a
				href={href}
				className={`${styles.animatedLink} ${className}`}
				onClick={onClick}
				target="_blank"
				rel="noopener noreferrer"
			>
				{children}
				{icon}
			</a>
		);
	}

	return (
		<button
			type="button"
			className={`${styles.animatedLink} ${className}`}
			onClick={onClick}
		>
			{children}
			{icon}
		</button>
	);
}
