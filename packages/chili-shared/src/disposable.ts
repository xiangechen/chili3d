// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface IDisposable {
    dispose(): Promise<void> | void;
}

export function isDisposable(value: any): value is IDisposable {
    if (typeof value.dispose !== "function") return false;

    const disposeFun: Function = value.dispose;

    // `.dispose()` takes in no arguments
    if (disposeFun.length > 0) {
        return false;
    }

    return true;
}
