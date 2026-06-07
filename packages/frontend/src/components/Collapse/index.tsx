import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import styles from "./index.module.css";

export interface CollapseProps {
	in: boolean;
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}

export function Collapse({
	in: isOpen,
	children,
	className = "",
	style,
}: CollapseProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number>(0);

	useEffect(() => {
		if (!contentRef.current) return;

		if (!isOpen) {
			setContentHeight(0);
			return;
		}

		setContentHeight(contentRef.current.scrollHeight);

		const observer = new ResizeObserver(() => {
			if (contentRef.current) {
				setContentHeight(contentRef.current.scrollHeight);
			}
		});

		observer.observe(contentRef.current);

		return () => observer.disconnect();
	}, [isOpen]);

	return (
		<div
			className={`${styles.wrapper} ${isOpen ? styles.wrapperOpen : ""} ${className}`}
			style={{
				...style,
				height: contentHeight === 0 && !isOpen ? 0 : `${contentHeight}px`,
			}}
		>
			<div ref={contentRef} className={styles.inner}>
				{children}
			</div>
		</div>
	);
}
