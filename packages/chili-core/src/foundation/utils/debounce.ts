// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
