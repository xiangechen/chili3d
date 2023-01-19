// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "./i18n";

export class Valid<T extends keyof I18n = keyof I18n> {
    constructor(readonly isOk: boolean, readonly error?: T) {}

    static ok<T extends keyof I18n>() {
        return new Valid<T>(true, undefined);
    }

    static error<T extends keyof I18n>(err: T) {
        return new Valid(false, err);
    }
}
