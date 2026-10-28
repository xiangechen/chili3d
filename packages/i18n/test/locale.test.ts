// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { en, ptBr, zhCn } from "../src";

describe("i18n locales", () => {
    const locales = [
        { name: "en", locale: en },
        { name: "zhCn", locale: zhCn },
        { name: "ptBr", locale: ptBr },
    ] as const;

    describe("locale structure", () => {
        for (const { name, locale } of locales) {
            test(`${name} should have display and language`, () => {
                expect(typeof locale.display).toBe("string");
                expect(locale.display.length).toBeGreaterThan(0);
                expect(typeof locale.language).toBe("string");
                expect(locale.language.length).toBeGreaterThan(0);
            });

            test(`${name} should have a non-empty translation object`, () => {
                expect(typeof locale.translation).toBe("object");
                expect(Object.keys(locale.translation).length).toBeGreaterThan(0);
            });
        }
    });

    describe("locale languages", () => {
        test.each([
            { name: "en", locale: en, language: "en" },
            { name: "zhCn", locale: zhCn, language: "zh-CN" },
            { name: "ptBr", locale: ptBr, language: "pt-BR" },
        ] as const)("$name language should be $language", ({ locale, language }) => {
            expect(locale.language).toBe(language);
        });
    });

    describe("key consistency between en and zh-cn", () => {
        test("zh-cn should have all keys present in en", () => {
            const enKeys = new Set(Object.keys(en.translation));
            const zhKeys = new Set(Object.keys(zhCn.translation));
            const missing = [...enKeys].filter((k) => !zhKeys.has(k));
            expect(missing).toEqual([]);
        });

        test("en should have all keys present in zh-cn", () => {
            const enKeys = new Set(Object.keys(en.translation));
            const zhKeys = new Set(Object.keys(zhCn.translation));
            const extra = [...zhKeys].filter((k) => !enKeys.has(k));
            expect(extra).toEqual([]);
        });
    });

    describe("pt-br extends en", () => {
        test("pt-br should contain en keys via spread", () => {
            // pt-br uses ...en.translation, so it has all en keys
            const enKeys = new Set(Object.keys(en.translation));
            const ptKeys = new Set(Object.keys(ptBr.translation));
            const missingFromPt = [...enKeys].filter((k) => !ptKeys.has(k));
            expect(missingFromPt).toEqual([]);
        });
    });

    describe("common translation keys", () => {
        test("should contain essential UI keys", () => {
            const essentialKeys = [
                "common.confirm",
                "common.cancel",
                "common.name",
                "common.color",
                "toast.success",
                "toast.fail",
            ] as const;
            for (const key of essentialKeys) {
                expect(en.translation[key]).toBeDefined();
                expect(typeof en.translation[key]).toBe("string");
            }
        });

        test("should contain ribbon tab keys", () => {
            expect(en.translation["ribbon.tab.basic"]).toBeDefined();
            expect(en.translation["ribbon.tab.manager"]).toBeDefined();
        });

        test("should contain error keys", () => {
            expect(en.translation["error.default:{0}"]).toBeDefined();
            expect(en.translation["error.export.noNodeCanBeExported"]).toBeDefined();
            expect(en.translation["error.import.unsupportedFileType:{0}"]).toBeDefined();
        });
    });

    describe("translation values", () => {
        test("all translation values should be non-empty strings", () => {
            for (const [key, value] of Object.entries(en.translation)) {
                expect(typeof value).toBe("string");
                if (value.length === 0) {
                    throw new Error(`Empty translation for key: ${key}`);
                }
            }
        });

        test.each([
            { name: "zhCn", locale: zhCn },
            { name: "ptBr", locale: ptBr },
        ] as const)("$name translation values should be non-empty strings", ({ locale }) => {
            for (const [key, value] of Object.entries(locale.translation)) {
                expect(typeof value).toBe("string");
                if (value.length === 0) {
                    throw new Error(`Empty translation for key: ${key}`);
                }
            }
        });

        const placeholders = (value: string): string[] => value.match(/\{\d+\}/g)?.sort() ?? [];

        test.each([
            { name: "zhCn", locale: zhCn },
            { name: "ptBr", locale: ptBr },
        ] as const)("$name should keep the same placeholders as en for every key", ({ locale }) => {
            const mismatches: string[] = [];
            for (const [key, enValue] of Object.entries(en.translation)) {
                const translated = (locale.translation as Record<string, string>)[key];
                if (translated === undefined) {
                    mismatches.push(`${key}: missing in translation`);
                    continue;
                }
                const expected = placeholders(enValue);
                const actual = placeholders(translated);
                if (expected.join(",") !== actual.join(",")) {
                    mismatches.push(`${key}: expected ${expected} but got ${actual}`);
                }
            }
            expect(mismatches).toEqual([]);
        });
    });
});
