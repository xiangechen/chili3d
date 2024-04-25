// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys } from "chili-core";

export class Localize {
    constructor(readonly key: I18nKeys) {}

    set(e: HTMLElement) {
        I18n.set(e, this.key);
    }
}

export function localize(key: I18nKeys) {
    return new Localize(key);
}
