// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Serializer } from "../serialize";
import { IEqualityComparer } from "./equalityComparer";
import { Logger } from "./logger";

@Serializer.register(["isOk", "value", "error"])
export class Result<T, E = string> {
    readonly #isOk: boolean;
    @Serializer.serialze()
    get isOk(): boolean {
        return this.#isOk;
    }

    readonly #value: T | undefined;
    @Serializer.serialze()
    get value(): T {
        if (!this.#isOk) {
            Logger.warn("Result is error");
        }
        return this.#value!;
    }

    readonly #error: E | undefined;
    @Serializer.serialze()
    get error(): E {
        if (this.#isOk) {
            Logger.warn("Result is ok");
        }
        return this.#error!;
    }

    constructor(isOk: boolean, value: T | undefined, error: E | undefined) {
        this.#isOk = isOk;
        this.#value = value;
        this.#error = error;
    }

    parse<U>(): Result<U, E> {
        return Result.err(this.#error as E) as any;
    }

    isOkAnd(predict: (value: T | undefined) => boolean): boolean {
        return this.#isOk && predict(this.#value);
    }

    isErrorOr(predict: (value: T | undefined) => boolean): boolean {
        return !this.#isOk || predict(this.#value);
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

export class ResultEqualityComparer<T = any> implements IEqualityComparer<Result<T>> {
    constructor(readonly equal?: (left: T, right: T) => boolean) {}

    equals(left: Result<any, string>, right: Result<any, string>): boolean {
        if (!left.isOk || !right.isOk) {
            return false;
        }
        if (this.equal) {
            return this.equal(left.value, right.value);
        }
        return left.value === right.value;
    }
}
