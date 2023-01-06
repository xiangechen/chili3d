// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "./i18n";

export class Result<T, E = string> {
    private constructor(readonly value: T | undefined, readonly err: E | undefined) {}

    static ok<T, E = string>(value: T): Result<T, E> {
        return new Result<T, E>(value, undefined);
    }

    static error<T, E = string>(error: E): Result<T, E> {
        return new Result<T, E>(undefined, error);
    }

    isOk() {
        return this.value !== undefined;
    }

    isErr() {
        return this.err !== undefined;
    }

    ok() {
        return this.value;
    }

    error() {
        return this.err;
    }
}

export class Valid<T extends keyof I18n = keyof I18n> {
    constructor(readonly isOk: boolean, readonly error?: T) { }

    static ok<T extends keyof I18n>() {
        return new Valid<T>(true, undefined);
    }

    static error<T extends keyof I18n>(err: T) {
        return new Valid(false, err);
    }

}
