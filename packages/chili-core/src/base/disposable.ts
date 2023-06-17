// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface IDisposable {
    dispose(): void;
}

export namespace IDisposable {
    export function isDisposable(value: any): value is IDisposable {
        if (typeof value.dispose !== "function") return false;
        return value.dispose.length === 0;
    }
}
