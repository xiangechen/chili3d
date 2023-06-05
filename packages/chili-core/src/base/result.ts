// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

const DefaultUndefinedValue = Symbol();
const DefaultUndifinedError = Symbol();

export class Result<T, E = string> {
    get value(): T | undefined {
        if (this._value === DefaultUndefinedValue) return undefined;
        return this._value as T;
    }

    get error(): E | undefined {
        if (this._err === DefaultUndifinedError) return undefined;
        return this._err as E;
    }

    private constructor(private _value: T | symbol, private _err: E | symbol) {}

    static ok<T, E = string>(value: T): Result<T, E> {
        return new Result<T, E>(value, DefaultUndifinedError);
    }

    static error<T, E = string>(error: E): Result<T, E> {
        return new Result<T, E>(DefaultUndefinedValue, error);
    }

    isOk() {
        return this._value !== DefaultUndefinedValue;
    }

    hasError() {
        return this._err !== DefaultUndifinedError;
    }
}
