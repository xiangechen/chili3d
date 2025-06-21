// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { button, div } from "chili-controls";
import { DialogResult, I18n, I18nKeys } from "chili-core";
import style from "./dialog.module.css";

export class Dialog {
    private constructor() {}

    static show(title: I18nKeys, content: HTMLElement, callback?: (result: DialogResult) => void) {
        const dialog = document.createElement("dialog");
        document.body.appendChild(dialog);

        dialog.appendChild(
            div(
                { className: style.root },
                div({ className: style.title }, I18n.translate(title) ?? "chili3d"),
                div({ className: style.content }, content),
                div(
                    { className: style.buttons },
                    button({
                        textContent: I18n.translate("common.confirm"),
                        onclick: () => {
                            dialog.remove();
                            callback?.(DialogResult.ok);
                        },
                    }),
                    button({
                        textContent: I18n.translate("common.cancel"),
                        onclick: () => {
                            dialog.remove();
                            callback?.(DialogResult.cancel);
                        },
                    }),
                ),
            ),
        );

        dialog.showModal();
    }
}
