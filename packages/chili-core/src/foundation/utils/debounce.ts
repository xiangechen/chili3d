// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
