// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class Lazy<T> {
    private _value?: T;
    constructor(private readonly factory: () => T) {}

    get value(): T {
        if (this._value === undefined) {
            this._value = this.factory();
        }
        return this._value;
    }
}
