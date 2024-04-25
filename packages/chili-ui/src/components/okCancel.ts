// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18n } from "chili-core";
import { div, span, svg } from "./controls";
import style from "./okCancel.module.css";

export class OKCancel extends HTMLElement {
    private control?: AsyncController;

    constructor() {
        super();
        this.className = style.root;
        this.append(
            div(
                { className: style.container },
                span({
                    textContent: I18n.translate("ribbon.group.selection"),
                }),
                div({ className: style.spacer }),
                div(
                    { className: style.panel },
                    div(
                        {
                            className: style.icon,
                            onclick: this._onConfirm,
                        },
                        svg({ icon: "icon-confirm" }),
                        span({ textContent: I18n.translate("common.confirm") }),
                    ),
                    div(
                        {
                            className: style.icon,
                            onclick: this._onCancel,
                        },
                        svg({ icon: "icon-cancel" }),
                        span({ textContent: I18n.translate("common.cancel") }),
                    ),
                ),
            ),
        );
    }

    setControl(control: AsyncController | undefined) {
        this.control = control;
    }

    private _onConfirm = () => {
        this.control?.success();
    };

    private _onCancel = () => {
        this.control?.cancel();
    };
}

customElements.define("ok-cancel", OKCancel);
