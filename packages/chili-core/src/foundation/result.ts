// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IEqualityComparer } from "./equalityComparer";

export class Result<T, E = string> {
    readonly #isOk: boolean;
    readonly #value: T | undefined;
    readonly #error: E | undefined;

    get isOk(): boolean {
        return this.#isOk;
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

    ok(): T {
        if (!this.#isOk) {
            throw this.#error;
        }
        return this.#value!;
    }

    unchecked(): T | undefined {
        return this.#value;
    }

    error(): E {
        if (this.#isOk) {
            throw new Error(`Result is ok: ${this.#value}`);
        }
        return this.#error!;
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
            return this.equal(left.ok(), right.ok());
        }
        return left.ok() === right.ok();
    }
}
