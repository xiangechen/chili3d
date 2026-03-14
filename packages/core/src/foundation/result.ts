// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { serializable, serialize } from "../serialize";
import type { IEqualityComparer } from "./equalityComparer";
import { Logger } from "./logger";

export interface ResultOptions<T, E = string> {
    isOk: boolean;
    value: T | undefined;
    error: E | undefined;
}

@serializable()
export class Result<T, E = string> {
    readonly #isOk: boolean;
    readonly #value: T | undefined;
    readonly #error: E | undefined;

    @serialize()
    get isOk(): boolean {
        return this.#isOk;
    }

    @serialize()
    get value(): T {
        if (!this.#isOk) Logger.warn("Result is error");
        return this.#value!;
    }

    @serialize()
    get error(): E {
        if (this.#isOk) Logger.warn("Result is ok");
        return this.#error!;
    }

    constructor(options: ResultOptions<T, E>) {
        this.#isOk = options.isOk;
        this.#value = options.value;
        this.#error = options.error;
    }

    parse<U>(): Result<U, E> {
        return Result.err(this.#error as E);
    }

    isOkAnd(predict: (value: T) => boolean): boolean {
        return this.#isOk && predict(this.#value!);
    }

    isErrorOr(predict: (value: T) => boolean): boolean {
        return !this.#isOk || predict(this.#value!);
    }

    unchecked(): T | undefined {
        return this.#value;
    }

    static ok<T>(value: T): Result<T, never> {
        return new Result({ isOk: true, value, error: undefined }) as any;
    }

    static err<E>(error: E): Result<any, E> {
        return new Result({ isOk: false, value: undefined, error }) as any;
    }
}

export class ResultEqualityComparer<T> implements IEqualityComparer<Result<T>> {
    constructor(readonly equal?: (left: T, right: T) => boolean) {}

    equals(left: Result<T>, right: Result<T>): boolean {
        if (!left.isOk || !right.isOk) return false;
        return this.equal ? this.equal(left.value, right.value) : left.value === right.value;
    }
}
