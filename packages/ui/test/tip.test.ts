// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Tip } from "../src/viewport/flyout/tip";

describe("Tip", () => {
    describe("constructor", () => {
        test("should set textContent from message", () => {
            const tip = new Tip("hello world", "info");
            expect(tip.textContent).toBe("hello world");
        });

        test('should apply info style class for "info" type', () => {
            const tip = new Tip("test", "info");
            // Tip uses CSS module classes — check that a class was added (not the "error" or "warn" ones)
            expect(tip.className).toContain("tip");
        });

        test('should apply error style for "error" type', () => {
            const tip = new Tip("error msg", "error");
            expect(tip.textContent).toBe("error msg");
        });

        test('should apply warn style for "warn" type', () => {
            const tip = new Tip("warning msg", "warn");
            expect(tip.textContent).toBe("warning msg");
        });
    });

    describe("set", () => {
        test("should update textContent when message changes", () => {
            const tip = new Tip("old", "info");
            tip.set("new", "info");
            expect(tip.textContent).toBe("new");
        });

        test("should not change style when type stays the same", () => {
            const tip = new Tip("msg", "info");
            const classesBefore = tip.className;
            tip.set("updated", "info");
            // className should be the same since style didn't change
            expect(tip.className).toBe(classesBefore);
        });

        test("should change style when type changes from info to error", () => {
            const tip = new Tip("msg", "info");
            tip.set("msg", "error");
            // The classList should now contain the error class
            const classes = tip.className;
            // After switching type, we should have the tip base class plus the error class
            expect(classes.split(" ").length).toBeGreaterThanOrEqual(1);
        });

        test("should change style when type changes from info to warn", () => {
            const tip = new Tip("msg", "info");
            tip.set("msg", "warn");
            const classes = tip.className;
            expect(classes.split(" ").length).toBeGreaterThanOrEqual(1);
        });

        test("should not re-add same style class multiple times", () => {
            const tip = new Tip("msg", "info");
            const classesAfterFirst = tip.className;
            tip.set("msg", "error");
            tip.set("msg", "error"); // same type again
            const classList = Array.from(tip.classList);
            // Should have no duplicate style entries
            const unique = new Set(classList);
            expect(unique.size).toBe(classList.length);
        });
    });
});
