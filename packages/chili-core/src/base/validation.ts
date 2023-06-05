// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class Validation<T> {
    constructor(readonly isOk: boolean, readonly error?: T) {}

    static ok<T>() {
        return new Validation<T>(true, undefined);
    }

    static error<T>(err: T) {
        return new Validation(false, err);
    }
}
