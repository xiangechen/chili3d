// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type Locale, Localize } from "../src/i18n/i18n";
import type { I18nKeys } from "../src/i18n/keys";

const mockLocaleEn: Locale = {
    display: "English",
    language: "en",
    translation: {
        "common.cancel": "Cancel",
        "common.confirm": "Confirm",
        "error.default:{0}": "Error: {0}",
    } as any,
};

const mockLocaleZh: Locale = {
    display: "中文",
    language: "zh-CN",
    translation: {
        "common.cancel": "取消",
        "common.confirm": "确认",
        "error.default:{0}": "错误: {0}",
    } as any,
};

describe("I18n", () => {
    describe("addLanguage", () => {
        test("should add a language to the languages map", () => {
            const newLocale = {
                display: "French",
                language: "fr",
                translation: { "common.cancel": "Annuler" } as any,
            };
            I18n.addLanguage(newLocale);
            expect(I18n.getLanguages()).toContain(newLocale);
        });
    });

    describe("getLanguages", () => {
        test("should return all added languages", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            const languages = I18n.getLanguages();
            expect(languages).toContain(mockLocaleEn);
            expect(languages).toContain(mockLocaleZh);
        });
    });

    describe("defaultLanguage", () => {
        test("should return the browser language if it matches", () => {
            Object.defineProperty(navigator, "language", {
                value: "en-US",
                writable: true,
            });
            expect(I18n.defaultLanguage()).toBe("en");
        });

        test("should return 'en' if browser language does not match", () => {
            Object.defineProperty(navigator, "language", {
                value: "fr-FR",
                writable: true,
            });
            expect(I18n.defaultLanguage()).toBe("en");
        });
    });

    describe("currentLanguage", () => {
        test("should return default language initially", () => {
            expect(I18n.currentLanguage()).toBe("en");
        });

        test("should return the set current language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.changeLanguage("en");
            expect(I18n.currentLanguage()).toBe("en");
        });
    });

    describe("translate", () => {
        test("should translate key using current language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            expect(I18n.translate("common.cancel")).toBe("Cancel");
        });

        test("should translate key with arguments", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            expect(I18n.translate("error.default:{0}", "test")).toBe("Error: test");
        });

        test("should fallback to en if key not found in current language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("zh-CN");
            (mockLocaleEn.translation as any)["common.new"] = "New";
            (mockLocaleZh.translation as any)["common.new"] = undefined;
            expect(I18n.translate("common.new" as I18nKeys)).toBe("New");
        });

        test("should return key if not found in any language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            expect(I18n.translate("unknown.key" as I18nKeys)).toBe("unknown.key");
        });
    });

    describe("isI18nKey", () => {
        test("should return true for valid key", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            expect(I18n.isI18nKey("common.cancel")).toBe(true);
        });

        test("should return false for invalid key", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            expect(I18n.isI18nKey("invalid.key")).toBe(false);
        });
    });

    describe("set", () => {
        test("should set textContent on element", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            const element = document.createElement("div");
            I18n.set(element, "textContent", "common.cancel");
            expect(element.textContent).toBe("Cancel");
            expect(element.dataset["chili18n"]).toBe("common.cancel_:_textContent");
        });

        test("should set title on element", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            const element = document.createElement("div");
            I18n.set(element, "title", "common.confirm");
            expect(element.title).toBe("Confirm");
            expect(element.dataset["chili18n"]).toBe("common.confirm_:_title");
        });

        test("should store args in WeakMap", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            const element = document.createElement("div");
            I18n.set(element, "textContent", "error.default:{0}", "test");
            expect(element.textContent).toBe("Error: test");
            // WeakMap access is internal, hard to test directly
        });
    });

    describe("changeLanguage", () => {
        test("should change current language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.changeLanguage("en");
            expect(I18n.currentLanguage()).toBe("en");
        });

        test("should not change if same language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.changeLanguage("en");
            expect(I18n.currentLanguage()).toBe("en");
        });

        test("should update all elements with data-chili18n", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            const element1 = document.createElement("div");
            const element2 = document.createElement("div");
            document.body.appendChild(element1);
            document.body.appendChild(element2);

            I18n.changeLanguage("en");
            I18n.set(element1, "textContent", "common.cancel");
            I18n.set(element2, "title", "common.confirm");

            I18n.changeLanguage("zh-CN");

            expect(element1.textContent).toBe("取消");
            expect(element2.title).toBe("确认");

            document.body.removeChild(element1);
            document.body.removeChild(element2);
        });
    });

    describe("combineTranslation", () => {
        test("should merge translations into existing language", () => {
            I18n.addLanguage(mockLocaleEn);
            I18n.addLanguage(mockLocaleZh);
            I18n.changeLanguage("en");
            I18n.combineTranslation("en", { "common.new": "New" } as any);
            expect(I18n.translate("common.new" as I18nKeys)).toBe("New");
        });
    });
});

describe("Localize", () => {
    beforeEach(() => {
        I18n.addLanguage(mockLocaleEn);
        I18n.addLanguage(mockLocaleZh);
        I18n.changeLanguage("en");
    });

    test("constructor should set key", () => {
        const localize = new Localize("common.cancel");
        expect(localize.key).toBe("common.cancel");
    });

    test("set should call I18n.set", () => {
        const localize = new Localize("common.cancel");
        const element = document.createElement("div");
        localize.set(element, "textContent");
        expect(element.textContent).toBe("Cancel");
    });
});
