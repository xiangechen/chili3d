// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants } from "../constants";
import en from "./en";
import { I18n } from "./i18n";
import zh from "./zh-cn";

let i18n: I18n = zh;
export { i18n, I18n };

export namespace Language {
    export const Languages = ["简体中文", "English"]

    export function set(idx: number): boolean {
        let newI18n = idx === 0 ? zh : en;
        if (newI18n === i18n) return false;
        i18n = newI18n;
        let elements = document.querySelectorAll("[data-i18n]");
        elements.forEach((e) => {
            let html = e as HTMLElement;
            let id = html?.dataset[Constants.I18nIdAttribute];
            if (id === undefined) return;
            html.textContent = (i18n as any)[id];
        });
        return true;
    }

}
