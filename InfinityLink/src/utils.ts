export function createHookFn(
    fn: Function,
    prefixs?: Function | Function[],
    postfixs?: Function | Function[],
): { function: Function; origin: Function } {
    return {
        function: function (...args) {
            if (prefixs instanceof Function) prefixs = [prefixs];
            if (postfixs instanceof Function) postfixs = [postfixs];

            let prefixResult = {
                cancel: false,
                args: undefined,
            };

            let callArgs;

            for (const prefix of prefixs ?? []) {
                prefixResult = prefix(...args);
                if (prefixResult?.cancel) return;
                if (prefixResult?.args)
                    callArgs = callArgs ?? prefixResult?.args;
            }
            let result;
            result = fn.apply(this, callArgs ?? args);

            for (const postfix of postfixs ?? []) {
                result = postfix?.apply(result, args) ?? result;
            }

            return result;
        },
        origin: fn,
    };
}

export const reactInstance = (e: HTMLElement) => e[Object.keys(e).find(v => v.includes('__reactInternalInstance'))!]

// from https://github.com/martinstark/throttle-ts
export const throttle = <R, A extends any[]>(
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

