// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export function debounce(fun: Function, ms: number): Function {
    let timeout: any;
    return function (this: any, ...args: any[]) {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            fun.apply(this, args);
            timeout = undefined;
        }, ms);
    };
}
