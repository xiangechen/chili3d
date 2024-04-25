// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import en from "./en";
import { I18nKeys } from "./keys";
import zh from "./zh-cn";

const I18nId = "chili18n";
const I18nArgs = new WeakMap<HTMLElement, any[]>();

export type Locale = {
    display: string;
    code: string;
    translation: {
        [key in I18nKeys]: string;
    } & {
        [key: string]: string;
    };
};

export type Translation = Record<I18nKeys, string>;

export enum Language {
    English,
    Chinese,
}

export namespace I18n {
    export const languages = new Map<Language, Locale>([
        [Language.English, en],
        [Language.Chinese, zh],
    ]);

    let _currentLanguage =
        navigator.language.toLowerCase() === "zh-cn" ? Language.Chinese : Language.English;
    export function currentLanguage() {
        return _currentLanguage;
    }

    export function combineTranslation(language: Language, translations: Record<string, string>) {
        let local = languages.get(language);
        if (local) {
            local.translation = {
                ...local.translation,
                ...translations,
            };
        }
    }

    export function translate(key: I18nKeys, ...args: any[]) {
        let text = languages.get(_currentLanguage)!.translation[key];
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

    export function changeLanguage(language: Language): boolean {
        if (!languages.has(language)) return false;
        _currentLanguage = language;
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
