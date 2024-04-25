// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys } from "chili-core";
import { div, span } from "./components";
import style from "./permanent.module.css";

export class Permanent {
    static show(action: () => Promise<void>, message: I18nKeys, ...args: any[]) {
        let dialog = document.createElement("dialog");
        dialog.appendChild(
            div(
                { className: style.container },
                div({ className: style.loading }),
                span({
                    className: style.message,
                    textContent: I18n.translate(message, ...args),
                }),
            ),
        );
        document.body.appendChild(dialog);
        action().finally(() => dialog.remove());

        dialog.showModal();
    }
}
