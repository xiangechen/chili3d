// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, PubSub } from "@chili3d/core";

/**
 * The datum value dialogs: a single number box (`promptDatum`) and the X/Y pair
 * (`promptDatumPair`), each published through `showDialog`.
 *
 * Split out of `SketchEditor` because a dialog is a different job from owning a session: these
 * build DOM, validate the typed number, and call back. They deliberately know nothing about the
 * solver — `onApplied` is where the caller re-solves and commits.
 *
 * `SketchEditor.editDatum` stays where it is: it reads the constraint through the solver and
 * decides whether the value is signed or must be positive. That is editor policy, not dialog
 * mechanics.
 */

/**
 * Shows the datum input in a modal dialog. A valid confirm runs `apply`, then `onApplied`.
 * Invalid input keeps the dialog open with an error message; cancelling runs `onCancel` and
 * changes nothing.
 */
export function promptDatum(
    initial: number,
    apply: (value: number) => void,
    onApplied: () => void,
    onCancel?: () => void,
    options?: { positiveOnly?: boolean },
): void {
    const textbox = document.createElement("input");
    textbox.value = initial.toFixed(2);
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
                const value = Number(textbox.value);
                if (!Number.isFinite(value) || (options?.positiveOnly !== false && value <= 0)) {
                    showDatumError(error);
                    return false;
                }
                apply(value);
                onApplied();
                return true;
            },
            onclick: () => {},
        },
        { content: "common.cancel", onclick: () => onCancel?.() },
    ]);
    setTimeout(() => textbox.select());
}

/** Two-value variant of `promptDatum`, for multi-datum constraints (Fix = X, Y). */
export function promptDatumPair(
    initial: [number, number],
    apply: (x: number, y: number) => void,
    onApplied: () => void,
): void {
    const { inputX, inputY, error, content } = createDatumPairInputs(initial);
    PubSub.default.pub("showDialog", "dialog.title.enterValue", content, [
        {
            content: "common.confirm",
            shouldClose: () => {
                const x = Number(inputX.value);
                const y = Number(inputY.value);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    showDatumError(error);
                    return false;
                }
                apply(x, y);
                onApplied();
                return true;
            },
            onclick: () => {},
        },
        { content: "common.cancel", onclick: () => {} },
    ]);
    setTimeout(() => inputX.select());
}

/** The hidden error line the datum prompts reveal when a typed value is rejected. */
function createErrorLabel(): HTMLLabelElement {
    const error = document.createElement("label");
    error.style.cssText = "color: red; font-size: 11px; display: none;";
    return error;
}

function showDatumError(error: HTMLLabelElement): void {
    error.textContent = I18n.translate("error.input.invalidNumber") ?? "invalid number";
    error.style.display = "";
}

/** The X/Y number boxes plus the shared error label, wrapped in a dialog body. */
function createDatumPairInputs(initial: [number, number]): {
    inputX: HTMLInputElement;
    inputY: HTMLInputElement;
    error: HTMLLabelElement;
    content: HTMLElement;
} {
    const inputX = document.createElement("input");
    const inputY = document.createElement("input");
    inputX.value = initial[0].toFixed(2);
    inputY.value = initial[1].toFixed(2);
    inputX.autofocus = true;
    const error = createErrorLabel();
    const content = document.createElement("div");
    content.append(inputX, inputY, error);
    return { inputX, inputY, error, content };
}
