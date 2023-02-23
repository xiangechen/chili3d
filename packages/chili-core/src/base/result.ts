// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "../i18n";

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
}
