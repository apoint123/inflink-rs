import { useState } from "react";

export function useLocalStorage<T>(
    key: string,
    initialValue: T,
    parse: (string:string) => T = JSON.parse,
    stringify: (value:T) => string = JSON.stringify,
): [T, (value: T | ((prevValue: T) => T)) => void] {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? parse(item) : initialValue;
        } catch (error) {
            console.log(error);
            return initialValue;
        }
    });

    const setValue = (value: T | ((prevValue: T) => T)) => {
        try {
            const valueToStore =
                value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, stringify(valueToStore));
        } catch (error) {
            console.log(error);
        }
    };

    return [storedValue, setValue];
}







const cachedFunctionMap: Map<string, Function> = new Map();

// https://github.com/Steve-xmh/LibSongInfo/blob/main/index.ts
export function callCachedSearchFunction<F extends (...args: any[]) => any>(
	searchFunctionName: string | ((func: Function) => boolean),
	args: Parameters<F>,
): ReturnType<F> {
	if (!cachedFunctionMap.has(searchFunctionName.toString())) {
		const findResult = betterncm.ncm.findApiFunction(searchFunctionName);
		if (findResult) {
			const [func, funcRoot] = findResult;
			cachedFunctionMap.set(searchFunctionName.toString(), func.bind(funcRoot));
		}
	}
	const cachedFunc = cachedFunctionMap.get(searchFunctionName.toString());
	if (cachedFunc) {
		return cachedFunc.apply(null, args);
	} else {
		throw new TypeError(`函数 ${searchFunctionName.toString()} 未找到`);
	}
}

export function getPlayingSong() {
    return callCachedSearchFunction("getPlaying", []);
}
