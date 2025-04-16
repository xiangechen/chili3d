// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
