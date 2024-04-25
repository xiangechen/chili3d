// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys, IPropertyChanged, Property, SelectableItems } from "chili-core";
import { button, div } from "./components";
import { RadioGroup } from "./components/itemsControl";
import style from "./dialog.module.css";

export class Dialog {
    private constructor() {}

    static show(title: I18nKeys, context: IPropertyChanged, callback: () => void) {
        let properties = Property.getProperties(context);
        let dialog = document.createElement("dialog");
        dialog.appendChild(
            div(
                { className: style.root },
                div({ className: style.title }, I18n.translate(title) ?? "chili3d"),
                ...properties.map((x) => {
                    let value = (context as any)[x.name];
                    if (value instanceof SelectableItems) {
                        return new RadioGroup(I18n.translate(x.display), value);
                    }
                    return "";
                }),
                div(
                    { className: style.buttons },
                    button({
                        textContent: I18n.translate("common.confirm"),
                        onclick: () => {
                            dialog.remove();
                            callback();
                        },
                    }),
                    button({
                        textContent: I18n.translate("common.cancel"),
                        onclick: () => dialog.remove(),
                    }),
                ),
            ),
        );
        document.body.appendChild(dialog);
        dialog.showModal();
    }
}
