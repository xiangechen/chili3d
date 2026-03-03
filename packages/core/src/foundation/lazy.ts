// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
