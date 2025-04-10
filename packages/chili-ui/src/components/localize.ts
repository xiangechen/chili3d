// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
