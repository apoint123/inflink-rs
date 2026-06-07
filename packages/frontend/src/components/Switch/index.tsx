import styles from "./index.module.css";

export interface SwitchProps {
	checked: boolean;
	onChange: (e: React.ChangeEvent<HTMLInputElement>, checked: boolean) => void;
}

export function Switch({ checked, onChange }: SwitchProps) {
	return (
		<label className={styles.switch}>
			<input
				type="checkbox"
				className={styles.input}
				checked={checked}
				onChange={(e) => onChange(e, e.target.checked)}
			/>
			<span className={styles.slider} />
		</label>
	);
}
