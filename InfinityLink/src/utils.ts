// from https://github.com/martinstark/throttle-ts
export const throttle = <R, A extends unknown[]>(
	fn: (...args: A) => R,
	delay: number,
): [(...args: A) => R | undefined, () => void, () => void] => {
	let wait = false;
	let timeout: undefined | number;
	let cancelled = false;

	function resetWait() {
		wait = false;
	}

	return [
		(...args: A) => {
			if (cancelled) return undefined;
			if (wait) return undefined;
			const val = fn(...args);
			wait = true;
			timeout = window.setTimeout(resetWait, delay);
			return val;
		},
		() => {
			cancelled = true;
			clearTimeout(timeout);
		},
		() => {
			clearTimeout(timeout);
			resetWait();
		},
	];
};

export function waitForElement(selector: string): Promise<HTMLElement> {
	return new Promise((resolve) => {
		const element = document.querySelector<HTMLElement>(selector);
		if (element) {
			resolve(element);
			return;
		}

		const observer = new MutationObserver((_mutations, obs) => {
			const foundElement = document.querySelector<HTMLElement>(selector);
			if (foundElement) {
				obs.disconnect();
				resolve(foundElement);
			}
		});

		observer.observe(document.body, { childList: true, subtree: true });
	});
}
