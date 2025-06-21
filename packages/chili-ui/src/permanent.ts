// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, span } from "chili-controls";
import { I18n, I18nKeys } from "chili-core";
import style from "./permanent.module.css";

export class Permanent {
    static async show(action: () => Promise<void>, message: I18nKeys, ...args: any[]) {
        let dialog = document.createElement("dialog");
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
        dialog.showModal();

        action().finally(() => dialog.remove());
    }
}
