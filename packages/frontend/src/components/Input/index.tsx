import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./index.module.css";

export const Input = forwardRef<
	HTMLInputElement,
	InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
	return (
		<input ref={ref} className={`${styles.control} ${className}`} {...props} />
	);
});
