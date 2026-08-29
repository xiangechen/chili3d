// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, PubSub } from "@chili3d/core";

/**
 * Modal text input (same pattern as the sketch datum dialog): confirm validates and
 * runs `onConfirm`; `validate` returns an error message to keep the dialog open.
 */
export function promptText(
    title: I18nKeys,
    initial: string,
    validate: (value: string) => string | undefined,
    onConfirm: (value: string) => void,
): void {
    const textbox = document.createElement("input");
    textbox.value = initial;
    textbox.autofocus = true;
    const error = document.createElement("label");
    error.style.cssText = "color: red; font-size: 11px; display: none;";
    const content = document.createElement("div");
    content.append(textbox, error);

    PubSub.default.pub("showDialog", title, content, [
        {
            content: "common.confirm",
            shouldClose: () => {
                const message = validate(textbox.value.trim());
                if (message !== undefined) {
                    error.textContent = message;
                    error.style.display = "";
                    return false;
                }
                onConfirm(textbox.value.trim());
                return true;
            },
            onclick: () => {},
        },
        { content: "common.cancel", onclick: () => {} },
    ]);
    setTimeout(() => textbox.select());
}

/** Modal positive-number input; invalid input keeps the dialog open. */
export function promptNumber(title: I18nKeys, initial: number, onConfirm: (value: number) => void): void {
    promptText(
        title,
        String(initial),
        (text) => {
            const value = Number(text);
            return Number.isFinite(value) && value > 0
                ? undefined
                : (I18n.translate("error.input.invalidNumber") ?? "invalid number");
        },
        (text) => onConfirm(Number(text)),
    );
}
