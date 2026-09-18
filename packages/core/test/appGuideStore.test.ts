// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppGuideStore } from "../src/guide";

describe("AppGuideStore", () => {
    afterEach(() => {
        // Module-level state: every test cleans up what it registered.
        AppGuideStore.unregisterSection("demo");
        AppGuideStore.unregisterSection("other");
        AppGuideStore.clearBase();
    });

    test("should start empty", () => {
        expect(AppGuideStore.getSections()).toEqual([]);
    });

    test("should keep registered sections in registration order", () => {
        AppGuideStore.registerSection({ name: "demo", content: "first" });
        AppGuideStore.registerSection({ name: "other", content: "second" });

        expect(AppGuideStore.getSections()).toEqual([
            { name: "demo", content: "first" },
            { name: "other", content: "second" },
        ]);
    });

    test("should replace a section registered under the same name", () => {
        AppGuideStore.registerSection({ name: "demo", content: "old" });
        AppGuideStore.registerSection({ name: "demo", content: "new" });

        expect(AppGuideStore.getSections()).toEqual([{ name: "demo", content: "new" }]);
    });

    test("should remove a section without touching the others", () => {
        AppGuideStore.registerSection({ name: "demo", content: "first" });
        AppGuideStore.registerSection({ name: "other", content: "second" });

        AppGuideStore.unregisterSection("demo");

        expect(AppGuideStore.getSections()).toEqual([{ name: "other", content: "second" }]);
    });

    test("should hold no base override until one is set", () => {
        expect(AppGuideStore.getBase()).toBeUndefined();

        AppGuideStore.setBase("replacement manual");

        expect(AppGuideStore.getBase()).toBe("replacement manual");
    });

    test("should keep the last base override when several are set", () => {
        AppGuideStore.setBase("first");
        AppGuideStore.setBase("second");

        expect(AppGuideStore.getBase()).toBe("second");
    });

    test("should drop the base override on clear, leaving the sections alone", () => {
        AppGuideStore.setBase("replacement manual");
        AppGuideStore.registerSection({ name: "demo", content: "first" });

        AppGuideStore.clearBase();

        expect(AppGuideStore.getBase()).toBeUndefined();
        expect(AppGuideStore.getSections()).toEqual([{ name: "demo", content: "first" }]);
    });

    test("should ignore unregistering a name that was never registered", () => {
        AppGuideStore.registerSection({ name: "demo", content: "first" });

        expect(() => AppGuideStore.unregisterSection("missing")).not.toThrow();
        expect(AppGuideStore.getSections()).toEqual([{ name: "demo", content: "first" }]);
    });
});
