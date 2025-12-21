type PatchedSetItem = {
	(key: string, value: string): void;
	__isPatchedByInfLink?: boolean;
};

/**
 * 猴子补丁 localStorage.setItem 以便在当前页面也能监听到变化
 *
 * 用来实时同步当前的主题
 */
export function patchLocalStorage() {
	if ((localStorage.setItem as PatchedSetItem).__isPatchedByInfLink) {
		return;
	}

	const originalSetItem = localStorage.setItem;

	localStorage.setItem = (key: string, value: string) => {
		const oldValue = localStorage.getItem(key);

		originalSetItem.call(localStorage, key, value);

		const event = new StorageEvent("storage", {
			key,
			newValue: value,
			oldValue,
			storageArea: localStorage,
		});
		window.dispatchEvent(event);
	};

	(localStorage.setItem as PatchedSetItem).__isPatchedByInfLink = true;
}
