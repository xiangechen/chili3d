// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

export class Lazy<T> {
    #value?: T;
    readonly #factory: () => T;

    constructor(factory: () => T) {
        this.#factory = factory;
    }

    get value(): T {
        if (this.#value === undefined) {
            this.#value = this.#factory();
        }
        return this.#value;
    }
}
