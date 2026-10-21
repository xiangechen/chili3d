// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FontCatalog, I18n, type I18nKeys, type ParameterValue, PubSub, Result } from "@chili3d/core";
import { parseDatumInput } from "./datumPrompt";

/**
 * The text edit dialog — what double-clicking a placed text opens: its string, its height,
 * its angle and its font, prefilled with what the entity holds.
 *
 * Split from `SketchEditor` for the reason `datumPrompt.ts` is: a dialog builds DOM and
 * validates typed text, the editor owns what a confirmed value does. The size box reads
 * like a datum's — an expression is fine, `resolveSize` is the editor's reading of it —
 * and the angle box reads like it but in degrees, where the data is radians: the dialog
 * converts at the boundary, so a confirmed edit is already in the sketch's units. A
 * local-file font cannot be re-picked here: the choices are the font the text already has
 * and the catalogue (the creation command's font row keeps the full picker).
 */

/** What a confirm hands back: the string verbatim, the height in millimetres, the angle in RADIANS. */
export interface SketchTextEdit {
    text: string;
    size: number;
    /** Baseline direction, radians counter-clockwise — the dialog itself reads and writes degrees. */
    angle: number;
    fontName: string;
}

/**
 * Shows the text edit dialog modally. A valid confirm runs `onConfirm`, then closes; an
 * invalid one keeps the dialog open with an error message, the way `promptDatum` handles
 * bad input. Cancelling changes nothing and calls nothing. A box still holding its prefill
 * confirms the STORED value, not the parsed prefill: the prefill is display-rounded, and
 * reading it back would invent an edit the user never made.
 */
export function promptSketchText(
    initial: SketchTextEdit,
    onConfirm: (edited: SketchTextEdit) => void,
    resolveSize: (input: ParameterValue) => Result<number>,
    resolveAngle: (input: ParameterValue) => Result<number>,
): void {
    const textbox = document.createElement("input");
    textbox.value = initial.text;
    textbox.autofocus = true;
    const sizebox = document.createElement("input");
    const sizePrefill = initial.size.toFixed(2);
    sizebox.value = sizePrefill;
    const anglebox = document.createElement("input");
    const anglePrefill = ((initial.angle * 180) / Math.PI).toFixed(2);
    anglebox.value = anglePrefill;
    const fontbox = fontOptions(initial.fontName);
    const error = createErrorLabel();

    const content = document.createElement("div");
    content.append(
        row("text.content", textbox),
        row("text.size", sizebox),
        row("text.angle", anglebox),
        row("font.select", fontbox),
        error,
    );
    PubSub.default.pub("showDialog", "text.edit", content, [
        {
            content: "common.confirm",
            // validation lives in shouldClose: the dialog runs onclick even when
            // shouldClose vetoes closing, so confirming there would confirm invalid values
            shouldClose: () => {
                const edited = validateTextEdit(
                    textbox.value,
                    sizebox.value,
                    anglebox.value,
                    fontbox.value,
                    resolveSize,
                    resolveAngle,
                );
                if (!edited.isOk) {
                    showError(error, edited.error);
                    return false;
                }
                // A box the user did not touch keeps the stored value: the prefill is
                // display-rounded (toFixed(2)), and parsing it back would invent an edit
                // — a phantom commit and a re-scaled contour set — the user never made.
                const value = edited.value;
                if (sizebox.value === sizePrefill) value.size = initial.size;
                if (anglebox.value === anglePrefill) value.angle = initial.angle;
                onConfirm(value);
                return true;
            },
            onclick: () => {},
        },
        { content: "common.cancel", onclick: () => {} },
    ]);
    setTimeout(() => textbox.select());
}

/**
 * The dialog's answer, or the message to show: the string must say something, the height
 * must read as a positive length, and the angle as a number of degrees — any of them is a
 * direction, so it has no floor. The string is handed over verbatim — leading spaces are
 * the user's to keep; only a string with nothing BUT space is refused, since it lays out
 * to no glyphs. Exported for the tests: the degree/radian boundary is the dialog's own
 * contract, and this is where it is pinned.
 */
export function validateTextEdit(
    text: string,
    size: string,
    angle: string,
    fontName: string,
    resolveSize: (input: ParameterValue) => Result<number>,
    resolveAngle: (input: ParameterValue) => Result<number>,
): Result<SketchTextEdit> {
    if (text.trim() === "") return Result.err(emptyText());

    const sizeInput = parseDatumInput(size);
    if (sizeInput === "") return Result.err(invalidNumber());
    const resolvedSize = resolveSize(sizeInput);
    if (!resolvedSize.isOk) return Result.err(resolvedSize.error);
    if (resolvedSize.value <= 0) return Result.err(invalidNumber());

    const angleInput = parseDatumInput(angle);
    if (angleInput === "") return Result.err(invalidNumber());
    const resolvedAngle = resolveAngle(angleInput);
    if (!resolvedAngle.isOk) return Result.err(resolvedAngle.error);

    return Result.ok({
        text,
        size: resolvedSize.value,
        // the data's unit is the radian; the box's is the degree
        angle: (resolvedAngle.value * Math.PI) / 180,
        fontName,
    });
}

/**
 * The font choices: the entity's current one first when the catalogue does not list it —
 * a local-file font has no catalogue entry, and keeping it selectable is what keeps the
 * dialog from silently switching fonts when only the text was meant to change — then
 * every catalogue family.
 */
function fontOptions(current: string): HTMLSelectElement {
    const select = document.createElement("select");
    const families = FontCatalog.map((font) => font.family);
    for (const family of families.includes(current) ? families : [current, ...families]) {
        const option = document.createElement("option");
        option.value = family;
        option.textContent = family;
        select.append(option);
    }
    select.value = current;
    return select;
}

/** A labelled field line; wrapping the field makes the label its click target too. */
function row(labelKey: I18nKeys, field: HTMLElement): HTMLElement {
    const label = document.createElement("label");
    label.textContent = I18n.translate(labelKey) ?? labelKey;
    label.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;";
    field.style.flex = "1";
    field.style.minWidth = "0";
    label.append(field);
    return label;
}

function invalidNumber(): string {
    return I18n.translate("error.input.invalidNumber") ?? "invalid number";
}

function emptyText(): string {
    return I18n.translate("error.input.emptyText") ?? "enter some text";
}

/** The hidden error line the dialog reveals when an input is rejected. */
function createErrorLabel(): HTMLLabelElement {
    const error = document.createElement("label");
    error.style.cssText = "color: red; font-size: 11px; display: none;";
    return error;
}

function showError(error: HTMLLabelElement, message: string): void {
    error.textContent = message;
    error.style.display = "";
}
