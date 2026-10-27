// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { errorText, I18n, type I18nKeys, Logger, PubSub } from "@chili3d/core";
import { div, span } from "@chili3d/element";
import style from "./permanent.module.css";

export class Permanent {
    /**
     * Runs `action` under a modal spinner and reports how it went. An action that used to
     * reject here vanished without a word — the spinner closed and the user was left
     * believing the save had worked — so a failure is surfaced as the app's error toast.
     */
    static async show(action: () => Promise<void>, message: I18nKeys, ...args: any[]) {
        // `showModal()` takes the focus, and browsers differ on where it goes back when the
        // dialog is removed — put it back where it was, so a Ctrl+S from a text box leaves
        // the caret where the user left it.
        const previousFocus =
            document.activeElement instanceof HTMLElement && document.activeElement !== document.body
                ? document.activeElement
                : undefined;
        const dialog = document.createElement("dialog");
        dialog.appendChild(
            div(
                { className: style.container },
                div({
                    className: style.loading,
                    style: {
                        animation: `${style.circle} infinite 0.75s linear`,
                    },
                }),
                span({
                    className: style.message,
                    textContent: I18n.translate(message, ...args),
                }),
            ),
        );
        document.body.appendChild(dialog);

        try {
            dialog.showModal();
        } catch (error) {
            // No top layer (or a stale modal): the spinner is a courtesy, the work is not.
            Logger.warn(`permanent dialog could not be opened: ${errorText(error)}`);
        }

        try {
            await action();
        } catch (error) {
            PubSub.default.pub("displayError", errorText(error));
        } finally {
            dialog.remove();
            // Only when nobody else claimed the focus: an action may open its own dialog, and
            // pulling the focus out of that one would leave a modal the keyboard cannot reach.
            const active = document.activeElement;
            if (previousFocus && (active === null || active === document.body)) {
                previousFocus.focus();
            }
        }
    }
}
