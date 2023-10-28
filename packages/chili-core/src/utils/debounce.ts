// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export const debounce = <F extends (...args: any[]) => void, P extends Parameters<F>>(
    fun: F,
    ms: number,
) => {
    let timeout: number | undefined;
    return (...args: P) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = window.setTimeout(() => {
            fun(...args);
            timeout = undefined;
        }, ms);
    };
};
