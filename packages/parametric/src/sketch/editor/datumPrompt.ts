// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type ParameterValue, PubSub, Result } from "@chili3d/core";

/**
 * The datum value dialogs: a single box (`promptDatum`) and the X/Y pair
 * (`promptDatumPair`), each published through `showDialog`.
 *
 * Split out of `SketchEditor` because a dialog is a different job from owning a session: these
 * build DOM, validate the typed text, and call back. They deliberately know nothing about the
 * solver — `onApplied` is where the caller re-solves and commits, and `options.resolve` is how
 * the caller supplies expression semantics (the dialog itself cannot tell a variable name from
 * a typo). That is also why `positiveOnly` is checked against the RESOLVED value: `-w` is a
 * negative input even though its text does not start with a minus.
 *
 * `SketchEditor.editDatum` stays where it is: it reads the constraint through the solver and
 * decides whether the value is signed or must be positive. That is editor policy, not dialog
 * mechanics.
 */

/**
 * The textbox's content as a parameter value: a number when it reads as one (so a plain
 * `50` stays a literal), otherwise the raw text, to be resolved as an expression.
 */
export function parseDatumInput(text: string): ParameterValue {
    const trimmed = text.trim();
    const value = Number(trimmed);
    return trimmed !== "" && Number.isFinite(value) ? value : trimmed;
}

/**
 * Shows the datum input in a modal dialog. A valid confirm runs `apply`, then `onApplied`.
 * Invalid input keeps the dialog open with an error message; cancelling runs `onCancel` and
 * changes nothing.
 */
export function promptDatum(
    initial: ParameterValue,
    apply: (value: ParameterValue) => void,
    onApplied: () => void,
    onCancel?: () => void,
    options?: {
        positiveOnly?: boolean;
        /** Resolves an input to its display value — supplied by the editor, error text included. */
        resolve?: (input: ParameterValue) => Result<number>;
    },
): void {
    const textbox = document.createElement("input");
    textbox.value = typeof initial === "number" ? initial.toFixed(2) : initial;
    textbox.autofocus = true;
    const error = createErrorLabel();
    const content = document.createElement("div");
    content.append(textbox, error);
    PubSub.default.pub("showDialog", "dialog.title.enterValue", content, [
        {
            content: "common.confirm",
            // validation lives in shouldClose: the dialog runs onclick even when
            // shouldClose vetoes closing, so applying there would apply invalid values
            shouldClose: () => {
                const parsed = validateDatumInput(textbox.value, options);
                if (!parsed.isOk) {
                    showDatumError(error, parsed.error);
                    return false;
                }
                apply(parsed.value);
                onApplied();
                return true;
            },
            onclick: () => {},
        },
        { content: "common.cancel", onclick: () => onCancel?.() },
    ]);
    setTimeout(() => textbox.select());
}

/**
 * Validates one textbox content, returning the input to apply or the message to show. A
 * literal is always acceptable (when `positiveOnly`, only a positive one); an expression
 * needs `resolve` to judge it, and is rejected outright when the caller supplied none.
 *
 * A `Result` rather than `value | message` because an expression IS a string — the two
 * would be indistinguishable.
 */
function validateDatumInput(
    text: string,
    options?: {
        positiveOnly?: boolean;
        resolve?: (input: ParameterValue) => Result<number>;
    },
): Result<ParameterValue> {
    const input = parseDatumInput(text);
    if (input === "") return Result.err(invalidNumber());

    const resolved = options?.resolve?.(input) ?? (typeof input === "number" ? Result.ok(input) : undefined);
    if (resolved === undefined) return Result.err(invalidNumber());
    if (!resolved.isOk) return Result.err(resolved.error);
    if (options?.positiveOnly !== false && resolved.value <= 0) return Result.err(invalidNumber());
    return Result.ok(input);
}

/** Two-value variant of `promptDatum`, for multi-datum constraints (Fix = X, Y). */
export function promptDatumPair(
    initial: [ParameterValue, ParameterValue],
    apply: (x: ParameterValue, y: ParameterValue) => void,
    onApplied: () => void,
    options?: {
        positiveOnly?: boolean;
        resolve?: (input: ParameterValue) => Result<number>;
    },
): void {
    const { inputX, inputY, error, content } = createDatumPairInputs(initial);
    PubSub.default.pub("showDialog", "dialog.title.enterValue", content, [
        {
            content: "common.confirm",
            shouldClose: () => {
                const x = validateDatumInput(inputX.value, options);
                if (!x.isOk) {
                    showDatumError(error, x.error);
                    return false;
                }
                const y = validateDatumInput(inputY.value, options);
                if (!y.isOk) {
                    showDatumError(error, y.error);
                    return false;
                }
                apply(x.value, y.value);
                onApplied();
                return true;
            },
            onclick: () => {},
        },
        { content: "common.cancel", onclick: () => {} },
    ]);
    setTimeout(() => inputX.select());
}

function invalidNumber(): string {
    return I18n.translate("error.input.invalidNumber") ?? "invalid number";
}

/** The hidden error line the datum prompts reveal when a typed value is rejected. */
function createErrorLabel(): HTMLLabelElement {
    const error = document.createElement("label");
    error.style.cssText = "color: red; font-size: 11px; display: none;";
    return error;
}

function showDatumError(error: HTMLLabelElement, message: string): void {
    error.textContent = message;
    error.style.display = "";
}

/** The X/Y number boxes plus the shared error label, wrapped in a dialog body. */
function createDatumPairInputs(initial: [ParameterValue, ParameterValue]): {
    inputX: HTMLInputElement;
    inputY: HTMLInputElement;
    error: HTMLLabelElement;
    content: HTMLElement;
} {
    const inputX = document.createElement("input");
    const inputY = document.createElement("input");
    inputX.value = typeof initial[0] === "number" ? initial[0].toFixed(2) : initial[0];
    inputY.value = typeof initial[1] === "number" ? initial[1].toFixed(2) : initial[1];
    inputX.autofocus = true;
    const error = createErrorLabel();
    const content = document.createElement("div");
    content.append(inputX, inputY, error);
    return { inputX, inputY, error, content };
}
