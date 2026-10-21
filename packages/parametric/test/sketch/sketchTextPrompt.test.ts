// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type DialogButton, type ParameterValue, PubSub, Result } from "@chili3d/core";
import {
    promptSketchText,
    type SketchTextEdit,
    validateTextEdit,
} from "../../src/sketch/editor/sketchTextPrompt";
import "./setup";

/** A resolver that takes numbers verbatim and refuses everything else (a typo'd expression). */
const resolveNumber = (input: ParameterValue): Result<number> =>
    typeof input === "number" ? Result.ok(input) : Result.err("unresolved");

describe("validateTextEdit", () => {
    test("a valid confirm hands back the string verbatim and the angle in RADIANS", () => {
        const edited = validateTextEdit("  hi ", "20", "45", "font", resolveNumber, resolveNumber);
        expect(edited.isOk).toBe(true);
        expect(edited.unchecked()).toEqual({
            text: "  hi ",
            size: 20,
            angle: Math.PI / 4,
            fontName: "font",
        });
    });

    test("a string of nothing but space is refused", () => {
        const edited = validateTextEdit("   ", "20", "0", "font", resolveNumber, resolveNumber);
        expect(edited.isOk).toBe(false);
    });

    test.each(["0", "-5"])("a non-positive height (%s) is refused", (size) => {
        const edited = validateTextEdit("hi", size, "0", "font", resolveNumber, resolveNumber);
        expect(edited.isOk).toBe(false);
    });

    test("a height that does not resolve is refused", () => {
        const edited = validateTextEdit("hi", "abc", "0", "font", resolveNumber, resolveNumber);
        expect(edited.isOk).toBe(false);
    });

    test("an angle that does not resolve is refused; any signed degree is a direction", () => {
        expect(validateTextEdit("hi", "20", "abc", "font", resolveNumber, resolveNumber).isOk).toBe(false);

        const edited = validateTextEdit("hi", "20", "-270", "font", resolveNumber, resolveNumber);
        expect(edited.isOk).toBe(true);
        expect(edited.unchecked()!.angle).toBeCloseTo(-Math.PI * 1.5, 9);
    });
});

describe("promptSketchText", () => {
    /** Opens the dialog, capturing its content, buttons and what a confirm hands back. */
    function openDialog(initial: SketchTextEdit) {
        let content: HTMLElement | undefined;
        let buttons: DialogButton[] | undefined;
        const onDialog = (...args: unknown[]) => {
            content = args[1] as HTMLElement;
            buttons = args[2] as DialogButton[];
        };
        PubSub.default.sub("showDialog", onDialog);
        let confirmed: SketchTextEdit | undefined;
        try {
            promptSketchText(initial, (edited) => (confirmed = edited), resolveNumber, resolveNumber);
        } finally {
            PubSub.default.remove("showDialog", onDialog);
        }
        expect(content).toBeDefined();
        expect(buttons).toBeDefined();
        return { content: content!, buttons: buttons!, confirmed: () => confirmed };
    }

    test("an untouched confirm keeps the stored values exactly, prefill rounding notwithstanding", () => {
        // the stored size needs more decimals than the toFixed(2) prefill shows: parsing
        // the prefill back must NOT read as an edit, or every open-and-confirm would
        // rewrite the text
        const dialog = openDialog({ text: "X", size: 12.345678, angle: 0.56789, fontName: "f" });

        expect(dialog.buttons[0].shouldClose!()).toBe(true);
        const confirmed = dialog.confirmed();
        expect(confirmed).toBeDefined();
        expect(confirmed!.size).toBe(12.345678);
        expect(confirmed!.angle).toBe(0.56789);
    });

    test("a box the user retyped parses the typed value; an untouched box still keeps its own", () => {
        const dialog = openDialog({ text: "X", size: 12.345678, angle: 0.56789, fontName: "f" });
        const sizebox = dialog.content.querySelectorAll("input")[1];
        expect(sizebox).toBeDefined();
        sizebox.value = "30";

        expect(dialog.buttons[0].shouldClose!()).toBe(true);
        const confirmed = dialog.confirmed();
        expect(confirmed!.size).toBe(30);
        expect(confirmed!.angle).toBe(0.56789);
    });
});
