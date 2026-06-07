import { ChevronDown } from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Input } from "../Input";
import styles from "./index.module.css";

export interface ComboboxOption {
	label: string;
	value: string;
}

export interface ComboboxProps {
	options: ComboboxOption[];
	value: string;
	onChange: (value: string) => void;
	onBlur?: () => void;
	className?: string;
	style?: CSSProperties;
	editable?: boolean;
	allowCustomValue?: boolean;
}

export function Combobox({
	options,
	value,
	onChange,
	onBlur,
	className = "",
	style,
	editable = true,
	allowCustomValue = false,
}: ComboboxProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isRendered, setIsRendered] = useState(false);
	const [dropdownDirection, setDropdownDirection] = useState<"down" | "up">(
		"down",
	);
	const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
	const [portalTheme, setPortalTheme] = useState<string | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const selectedOption = options.find((opt) => opt.value === value);
	const [inputValue, setInputValue] = useState(
		selectedOption ? selectedOption.label : allowCustomValue ? value : "",
	);

	useEffect(() => {
		let timeoutId: ReturnType<typeof setTimeout>;
		if (isOpen) {
			setIsRendered(true);
		} else {
			timeoutId = setTimeout(() => setIsRendered(false), 150);
		}
		return () => clearTimeout(timeoutId);
	}, [isOpen]);

	useEffect(() => {
		const opt = options.find((o) => o.value === value);
		if (opt) {
			setInputValue(opt.label);
		} else if (allowCustomValue) {
			setInputValue(value);
		} else {
			setInputValue("");
		}
	}, [value, options, allowCustomValue]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				containerRef.current?.contains(target) ||
				dropdownRef.current?.contains(target)
			) {
				return;
			}

			if (isOpen) {
				setIsOpen(false);
				const opt = options.find((o) => o.value === value);
				if (opt) {
					setInputValue(opt.label);
				} else if (!allowCustomValue) {
					setInputValue("");
				}
				if (onBlur) onBlur();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen, value, options, allowCustomValue, onBlur]);

	const filteredOptions = options.filter((opt) =>
		opt.label.toLowerCase().includes(inputValue.toLowerCase()),
	);

	const displayOptions =
		selectedOption && inputValue === selectedOption.label
			? options
			: filteredOptions;

	const updateDropdownPosition = useCallback(() => {
		if (isOpen && containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect();
			const spaceBelow = window.innerHeight - rect.bottom;
			const spaceAbove = rect.top;

			const estimatedDropdownHeight = Math.min(
				displayOptions.length * 34 + 8,
				200,
			);

			let direction: "down" | "up" = "down";
			if (spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow) {
				direction = "up";
			}
			setDropdownDirection(direction);

			const themeNode = containerRef.current.closest("[data-theme]");
			if (themeNode) {
				setPortalTheme(themeNode.getAttribute("data-theme"));
			} else {
				setPortalTheme(null);
			}

			setDropdownStyle({
				position: "fixed",
				left: rect.left,
				width: rect.width,
				...(direction === "down"
					? { top: rect.bottom }
					: { bottom: window.innerHeight - rect.top }),
				zIndex: 9999,
			});
		}
	}, [isOpen, displayOptions.length]);

	useEffect(() => {
		updateDropdownPosition();

		if (isOpen) {
			window.addEventListener("scroll", updateDropdownPosition, true);
			window.addEventListener("resize", updateDropdownPosition);
		}

		return () => {
			window.removeEventListener("scroll", updateDropdownPosition, true);
			window.removeEventListener("resize", updateDropdownPosition);
		};
	}, [isOpen, updateDropdownPosition]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!editable) return;
		const val = e.target.value;
		setInputValue(val);
		if (allowCustomValue) {
			onChange(val);
		}
		setIsOpen(true);
	};

	const handleOptionClick = (opt: ComboboxOption) => {
		setInputValue(opt.label);
		onChange(opt.value);
		setIsOpen(false);
		if (onBlur) onBlur();
	};

	const handleInputMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
		if (!editable) {
			e.preventDefault();
			setIsOpen((prev) => !prev);
			if (inputRef.current) {
				inputRef.current.focus();
			}
		} else {
			setIsOpen(true);
		}
	};

	const handleIconMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		setIsOpen((prev) => !prev);
		if (inputRef.current) {
			inputRef.current.focus();
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			const exactMatch = options.find(
				(opt) => opt.label.toLowerCase() === inputValue.toLowerCase(),
			);
			if (exactMatch) {
				handleOptionClick(exactMatch);
			} else if (allowCustomValue) {
				onChange(inputValue);
			}
			setIsOpen(false);
			if (onBlur) {
				onBlur();
			}
			if (e.target instanceof HTMLElement) {
				e.target.blur();
			}
		} else if (e.key === "Escape") {
			setIsOpen(false);
			const opt = options.find((o) => o.value === value);

			if (opt) {
				setInputValue(opt.label);
			} else if (allowCustomValue) {
				setInputValue(value);
			}
		}
	};

	const dropdownClass =
		dropdownDirection === "up"
			? isOpen
				? styles.dropdownUp
				: styles.dropdownUpClosing
			: isOpen
				? styles.dropdownDown
				: styles.dropdownDownClosing;

	const dropdownMenu = isRendered && displayOptions.length > 0 && (
		<div
			ref={dropdownRef}
			className={`${styles.dropdown} ${dropdownClass}`}
			style={dropdownStyle}
			data-theme={portalTheme ?? undefined}
		>
			{displayOptions.map((opt) => (
				<div
					key={opt.value}
					className={styles.option}
					onMouseDown={(e) => {
						e.preventDefault();
						handleOptionClick(opt);
					}}
					role="option"
					aria-selected={value === opt.value}
					tabIndex={-1}
				>
					{opt.label}
				</div>
			))}
		</div>
	);

	return (
		<div className={styles.container} ref={containerRef}>
			<Input
				ref={inputRef}
				type="text"
				className={`${styles.input} ${className}`}
				style={{
					cursor: editable ? "text" : "default",
					userSelect: editable ? "auto" : "none",
					width: 140,
					...style,
				}}
				value={inputValue}
				onChange={handleInputChange}
				onFocus={() => setIsOpen(true)}
				onMouseDown={handleInputMouseDown}
				onKeyDown={handleKeyDown}
				readOnly={!editable}
			/>

			<button
				type="button"
				className={styles.iconWrapper}
				onMouseDown={handleIconMouseDown}
				tabIndex={-1}
			>
				<ChevronDown size={16} strokeWidth={2.5} />
			</button>

			{createPortal(dropdownMenu, document.body)}
		</div>
	);
}
