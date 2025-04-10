// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { I18n, I18nKeys } from "chili-core";
import { div, span } from "./components";
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
