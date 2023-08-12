// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants, I18n, i18n } from "chili-core";

export class Localize {
    constructor(readonly key: keyof I18n) {}

    set(e: HTMLElement) {
        e.textContent = i18n[this.key];
        e.dataset[Constants.I18nIdAttribute] = this.key;
    }
}

export function localize(key: keyof I18n) {
    return new Localize(key);
}
