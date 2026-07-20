// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";

// Mock element helpers
rs.mock("@chili3d/element", () => {
    function createEl(tag: string, props: any, ...children: any[]): HTMLElement {
        const el = document.createElement(tag);
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.id) el.id = props.id;
            if (props.textContent !== undefined && typeof props.textContent === "string") {
                el.textContent = props.textContent;
            }
            if (props.onchange) (el as any)._onchange = props.onchange;
            if (props.selected !== undefined) (el as any).selected = props.selected;
        }
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
            else if (typeof c === "string") el.appendChild(document.createTextNode(c));
        }
        return el;
    }

    return {
        select: (props: any, ...children: any[]) => createEl("select", props, ...children),
        option: (props: any) => createEl("option", props),
    };
});

// Mock core services
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    return {
        ...actual,
        Config: {
            instance: {
                language: "en",
            },
        },
        I18n: {
            getLanguages: () => [
                { language: "en", display: "English" },
                { language: "zh-cn", display: "简体中文" },
                { language: "pt-br", display: "Português" },
            ],
            currentLanguage: () => "en",
        },
    };
});

import { LanguageSelector } from "../src/home/languageSelector";

describe("LanguageSelector", () => {
    describe("rendering", () => {
        test("should return a select element", () => {
            const el = LanguageSelector({});
            expect(el).toBeInstanceOf(HTMLSelectElement);
        });

        test("should contain option elements for all languages", () => {
            const el = LanguageSelector({}) as HTMLSelectElement;
            const options = el.querySelectorAll("option");
            expect(options.length).toBe(3);
        });

        test("should mark current language as selected", () => {
            const el = LanguageSelector({}) as HTMLSelectElement;
            const options = el.querySelectorAll("option");
            // First option (English) should be selected since currentLanguage is "en"
            const firstOption = options[0] as any;
            expect(firstOption.selected).toBe(true);
        });

        test("should accept additional HTML props", () => {
            const el = LanguageSelector({ className: "custom-lang", id: "lang-select" }) as HTMLSelectElement;
            expect(el.className).toBe("custom-lang");
            expect(el.id).toBe("lang-select");
        });

        test("should have onchange handler", () => {
            const el = LanguageSelector({}) as HTMLSelectElement & {
                _onchange?: (...args: unknown[]) => unknown;
            };
            const handler = (el as any)._onchange;
            expect(handler).toBeDefined();
            expect(typeof handler).toBe("function");
        });
    });
});
