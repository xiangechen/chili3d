// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, I18n, type Navigation3DType, Navigation3DTypes } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { LanguageSelector } from "../src/home/languageSelector";
import { Navigation3DSelector } from "../src/home/navigation3DSelector";
import { ThemeSelector } from "../src/home/themeSelector";

describe("LanguageSelector", () => {
    let originalLanguage: string;
    let originalLanguages: ReturnType<typeof I18n.getLanguages>;

    beforeEach(() => {
        originalLanguage = Config.instance.language;
    });

    afterEach(() => {
        Config.instance.language = originalLanguage;
    });

    test("should return a select element", () => {
        const el = LanguageSelector({});
        expect(el.tagName).toBe("SELECT");
    });

    test("should contain option elements for each language", () => {
        const languages = I18n.getLanguages();
        const el = LanguageSelector({}) as HTMLSelectElement;
        expect(el.options.length).toBe(languages.length);
    });

    test("should have the current language selected", () => {
        const languages = I18n.getLanguages();
        const currentLang = I18n.currentLanguage();
        const currentIndex = languages.findIndex((l) => l.language === currentLang);

        const el = LanguageSelector({}) as HTMLSelectElement;
        if (currentIndex >= 0 && currentIndex < el.options.length) {
            expect(el.options[currentIndex].selected).toBe(true);
        }
    });

    test("should apply custom HTML props", () => {
        const el = LanguageSelector({ className: "custom-class", id: "lang-picker" });
        expect(el.className).toBe("custom-class");
        expect(el.id).toBe("lang-picker");
    });
});

describe("ThemeSelector", () => {
    let originalThemeMode: string;

    beforeEach(() => {
        originalThemeMode = Config.instance.themeMode;
    });

    afterEach(() => {
        Config.instance.themeMode = originalThemeMode as any;
    });

    test("should return a select element", () => {
        const el = ThemeSelector({});
        expect(el.tagName).toBe("SELECT");
    });

    test("should contain 3 option elements (light, dark, system)", () => {
        const el = ThemeSelector({}) as HTMLSelectElement;
        expect(el.options.length).toBe(3);
    });

    test("should have the current theme selected", () => {
        Config.instance.themeMode = "dark" as any;
        const el = ThemeSelector({}) as HTMLSelectElement;

        let selectedValue = "";
        for (const opt of el.options) {
            if (opt.selected) selectedValue = opt.value;
        }
        expect(selectedValue).toBe("dark");
    });

    test("should have option values: light, dark, system", () => {
        const el = ThemeSelector({}) as HTMLSelectElement;
        const values = Array.from(el.options).map((o) => o.value);
        expect(values).toContain("light");
        expect(values).toContain("dark");
        expect(values).toContain("system");
    });

    test("should apply custom HTML props", () => {
        const el = ThemeSelector({ className: "theme-picker" });
        expect(el.className).toBe("theme-picker");
    });

    test("should update Config themeMode on change", () => {
        const el = ThemeSelector({}) as HTMLSelectElement;
        // Simulate selecting the "dark" option
        const darkIndex = Array.from(el.options).findIndex((o) => o.value === "dark");
        el.options[darkIndex]!.selected = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));

        expect(Config.instance.themeMode).toBe("dark");
    });
});

describe("Navigation3DSelector", () => {
    let originalNav: Navigation3DType;

    beforeEach(() => {
        originalNav = Config.instance.navigation3D;
    });

    afterEach(() => {
        Config.instance.navigation3D = originalNav;
    });

    test("should return a select element", () => {
        const el = Navigation3DSelector({});
        expect(el.tagName).toBe("SELECT");
    });

    test("should contain options for each Navigation3D type", () => {
        const el = Navigation3DSelector({}) as HTMLSelectElement;
        expect(el.options.length).toBe(Navigation3DTypes.length);
    });

    test("should have the current navigation type selected", () => {
        const currentNav = Config.instance.navigation3D;
        const currentIndex = Navigation3DTypes.indexOf(currentNav as (typeof Navigation3DTypes)[number]);
        const el = Navigation3DSelector({}) as HTMLSelectElement;
        if (currentIndex >= 0) {
            expect(el.options[currentIndex]?.selected).toBe(true);
        }
    });

    test("should apply custom HTML props", () => {
        const el = Navigation3DSelector({ id: "nav-picker" });
        expect(el.id).toBe("nav-picker");
    });

    test("should update Config navigation3D on change", () => {
        const el = Navigation3DSelector({}) as HTMLSelectElement;
        const targetIndex = Navigation3DTypes.findIndex((t) => t !== Config.instance.navigation3D);
        if (targetIndex >= 0) {
            el.selectedIndex = targetIndex;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            expect(Config.instance.navigation3D).toBe(Navigation3DTypes[targetIndex]);
        }
    });
});
