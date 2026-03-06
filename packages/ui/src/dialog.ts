// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type DialogButton, getCurrentApplication, I18n, type I18nKeys } from "@chili3d/core";
import { button, div } from "@chili3d/element";
import style from "./dialog.module.css";

const DefaultButtons: DialogButton[] = [
    {
        content: "common.confirm",
    },
    {
        content: "common.cancel",
    },
];

export function showDialog(title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) {
    const dialog = document.createElement("dialog");
    const host = getCurrentApplication()?.mainWindow ?? document.body;
    host.appendChild(dialog);

    dialog.appendChild(
        div(
            { className: style.root },
            div({ className: style.title }, I18n.translate(title) ?? "chili3d"),
            div({ className: style.content }, content),
            div(
                { className: style.buttons },
                ...combineButtons(buttons).map((btn) =>
                    button({
                        textContent: I18n.translate(btn.content),
                        onclick: async () => {
                            if (btn.onclick) {
                                await btn?.onclick();
                            }

                            if (btn.shouldClose?.() !== false) {
                                dialog.remove();
                            }
                        },
                    }),
                ),
            ),
        ),
    );

    dialog.showModal();
}

function combineButtons(buttons?: DialogButton[] | (() => void)): DialogButton[] {
    if (buttons === undefined) {
        return DefaultButtons;
    }

    if (Array.isArray(buttons)) {
        return buttons;
    }

    return [
        {
            content: "common.confirm",
            onclick: buttons,
        },
        {
            content: "common.cancel",
        },
    ];
}
