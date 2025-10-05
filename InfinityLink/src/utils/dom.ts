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
