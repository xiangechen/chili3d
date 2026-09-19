// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppGuideStore, Config, I18n, type Locale } from "@chili3d/core";
import { appGuide, resolveCommandRefs } from "../src/skills/appGuide";

afterEach(() => {
    Config.instance.navigation3D = "Chili3d";
    // Other suites register sections and overrides; read the built-in manual, not theirs.
    AppGuideStore.clearBase();
});

describe("appGuide manual", () => {
    test("resolves every command reference — one left over is a typo or a removed command", () => {
        const unresolved = [...appGuide.content.matchAll(/\{[a-z][\w.]*\}/g)].map((match) => match[0]);

        // A typo would otherwise reach the model as literal "{creat.line}" and be taught verbatim.
        expect(unresolved).toEqual([]);
    });

    test("leaves braces alone when they are not command references", () => {
        expect(resolveCommandRefs("compare {a.b} with {0} and {}")).toBe("compare {a.b} with {0} and {}");
    });

    test("resolves a reference to the label of the language the user is reading", () => {
        const original = I18n.currentLanguage();
        const testLocale = {
            display: "Test",
            language: "test-locale",
            translation: { "command.modify.fillet": "FAZ" },
        } as unknown as Locale;
        try {
            I18n.addLanguage(testLocale);
            I18n.changeLanguage("test-locale");

            expect(resolveCommandRefs("use {modify.fillet}")).toBe("use “FAZ” (Shift+F)");
        } finally {
            I18n.changeLanguage(original);
            I18n.removeLanguage("test-locale");
        }
    });

    test("resolves the hotkey of the active navigation profile, key sequences included", () => {
        Config.instance.navigation3D = "Revit";

        // The label is the identity translation (see core/test-utils/i18n.ts); the binding is
        // the point here: Revit binds line to "l+i", two keys pressed in turn, not a combo.
        expect(resolveCommandRefs("{create.line}")).toBe("“command.create.line” (L then I)");
    });

    test("reports every navigation profile's pan and rotate buttons", () => {
        const guide = appGuide.content;

        expect(guide).toContain("- Chili3d: pan = middle-drag, rotate = Shift + middle-drag");
        expect(guide).toContain("- Blender: pan = Shift + middle-drag, rotate = middle-drag");
        expect(guide).toContain("- Solidworks: pan = Ctrl + middle-drag, rotate = middle-drag");
    });

    test("names a command with no binding by its label alone", () => {
        // "doc.saveToFile" is registered but unbound: a trailing "(undefined)" would read as a bug.
        expect(resolveCommandRefs("{doc.saveToFile}")).toBe("“command.doc.saveToFile”");
    });
});
