// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Serializer } from "../serialize";
import { IEqualityComparer } from "./equalityComparer";
import { Logger } from "./logger";

@Serializer.register(["isOk", "value", "error"])
export class Result<T, E = string> {
    readonly #isOk: boolean;
    readonly #value: T | undefined;
    readonly #error: E | undefined;

    @Serializer.serialze()
    get isOk(): boolean {
        return this.#isOk;
    }

    @Serializer.serialze()
    get value(): T {
        if (!this.#isOk) Logger.warn("Result is error");
        return this.#value!;
    }

    @Serializer.serialze()
    get error(): E {
        if (this.#isOk) Logger.warn("Result is ok");
        return this.#error!;
    }

    constructor(isOk: boolean, value: T | undefined, error: E | undefined) {
        this.#isOk = isOk;
        this.#value = value;
        this.#error = error;
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
        return new Result(true, value, undefined) as any;
    }

    static err<E>(error: E): Result<any, E> {
        return new Result(false, undefined, error) as any;
    }
}

export class ResultEqualityComparer<T> implements IEqualityComparer<Result<T>> {
    constructor(readonly equal?: (left: T, right: T) => boolean) {}

    equals(left: Result<T>, right: Result<T>): boolean {
        if (!left.isOk || !right.isOk) return false;
        return this.equal ? this.equal(left.value, right.value) : left.value === right.value;
    }
}
