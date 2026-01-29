// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "./keys";

const I18nId = "chili18n";
const I18nArgs = new WeakMap<HTMLElement, any[]>();

export type Locale = {
    display: string;
    language: string;
    translation: {
        [key in I18nKeys]: string;
    } & {
        [key: string]: string;
    };
};

export type I18nPath = "textContent" | "title";

export class Localize {
    constructor(readonly key: I18nKeys) {}

    set(e: HTMLElement, path: I18nPath) {
        I18n.set(e, path, this.key);
    }
}

export type Translation = Record<I18nKeys, string>;

const DATASET_LINK_KEY = "_:_";
const languages = new Map<string, Locale>();
let _currentLanguage: string | undefined;

export class I18n {
    static currentLanguage() {
        _currentLanguage ??= I18n.defaultLanguage();
        return _currentLanguage;
    }

    static defaultLanguage(): string {
        const defaultLanguage = navigator.language.toLowerCase();
        const language = languages.keys().find((key) => key.toLowerCase() === defaultLanguage);
        if (language) {
            return language;
        }

        return "en";
    }

    static getLanguages(): Locale[] {
        return Array.from(languages.values());
    }

    static addLanguage(local: Locale) {
        languages.set(local.language, local);
    }

    static combineTranslation(language: string, translations: Record<string, string>) {
        const local = languages.get(language);
        if (local) {
            local.translation = {
                ...local.translation,
                ...translations,
            };
        }
    }

    static translate(key: I18nKeys, ...args: any[]) {
        const language = languages.get(I18n.currentLanguage());
        if (!language) {
            console.warn(`No translation for ${key} in ${language}`);
            return key;
        }
        return I18n.translateLanguage(language, key, ...args);
    }

    static translateLanguage(language: Locale, key: I18nKeys, ...args: any[]) {
        let text = language.translation[key] ?? languages.get("en")!.translation[key];
        if (text === undefined) {
            console.warn(`No translation for ${key} in ${language}`);
            return key;
        }
        if (args.length > 0) {
            text = text.replace(/\{(\d+)\}/g, (_, index) => args[index]);
        }
        return text;
    }

    static isI18nKey(key: string): key is I18nKeys {
        return key in languages.get("zh-CN")!.translation;
    }

    static set(dom: HTMLElement, path: I18nPath, key: I18nKeys, ...args: any[]) {
        dom[path] = I18n.translate(key, ...args);
        dom.dataset[I18nId] = `${key}${DATASET_LINK_KEY}${path}`;
        if (args.length > 0) {
            I18nArgs.set(dom, args);
        }
    }

    static changeLanguage(newLanguage: string) {
        if (newLanguage === _currentLanguage) return;
        const oldLanguage = _currentLanguage;
        _currentLanguage = newLanguage;

        document.querySelectorAll(`[data-${I18nId}]`).forEach((e) => {
            const html = e as HTMLElement;
            const data = html?.dataset[I18nId]?.split(DATASET_LINK_KEY);
            if (data?.length !== 2) return;
            const args = I18nArgs.get(html) ?? [];
            const [key, path] = data as [I18nKeys, I18nPath];
            const oldText = I18n.translateLanguage(languages.get(oldLanguage!)!, key, ...args);
            const newText = I18n.translate(key, ...args);
            html[path] = html[path].replace(oldText, newText);
        });
    }
}
