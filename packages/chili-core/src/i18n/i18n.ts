// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import en from "./en";
import { I18nKeys } from "./local";
import zh from "./zh-cn";

const I18nId = "chili18n";
const I18nArgs = new WeakMap<HTMLElement, any[]>();

export namespace I18n {
    let language = navigator.language.toLowerCase() === "zh-cn" ? zh : en;

    export const languages = [zh, en];

    export function translate(key: I18nKeys, ...args: any[]) {
        let text = language.translation[key];
        if (args.length > 0) {
            text = text.replace(/\{(\d+)\}/g, (_, index) => args[index]);
        }
        return text;
    }

    export function set(dom: HTMLElement, key: I18nKeys, ...args: any[]) {
        dom.textContent = translate(key, ...args);
        dom.dataset[I18nId] = key;
        if (args.length > 0) {
            I18nArgs.set(dom, args);
        }
    }

    export function changeLanguage(idx: number): boolean {
        if (idx < 0 || idx >= languages.length || language === languages[idx]) return false;
        language = languages[idx];
        document.querySelectorAll(`[data-${I18nId}]`).forEach((e) => {
            let html = e as HTMLElement;
            let id = html?.dataset[I18nId] as I18nKeys;
            if (id === undefined) return;
            let args = I18nArgs.get(html) ?? [];
            html.textContent = translate(id, ...args);
        });

        return true;
    }
}
