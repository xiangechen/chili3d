// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export interface IDisposable {
    dispose(): void;
}

export namespace IDisposable {
    export function isDisposable(value: unknown): value is IDisposable {
        return (
            value != null &&
            typeof value === "object" &&
            "dispose" in value &&
            typeof (value as IDisposable).dispose === "function" &&
            (value as IDisposable).dispose.length === 0
        );
    }
}
