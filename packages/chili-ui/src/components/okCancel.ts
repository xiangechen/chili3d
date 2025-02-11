// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18n } from "chili-core";
import { div, span, svg } from "./controls";
import style from "./okCancel.module.css";

export class OKCancel extends HTMLElement {
    private control?: AsyncController;

    constructor() {
        super();
        this.className = style.root;
        this.append(this.container());
    }

    private container() {
        return div(
            { className: style.container },
            span({ textContent: I18n.translate("ribbon.group.selection") }),
            div({ className: style.spacer }),
            this.buttons(),
        );
    }

    private buttons() {
        return div(
            { className: style.panel },
            this._createIcon("icon-confirm", I18n.translate("common.confirm"), this._onConfirm),
            this._createIcon("icon-cancel", I18n.translate("common.cancel"), this._onCancel),
        );
    }

    private _createIcon(icon: string, text: string, onClick: () => void) {
        return div({ className: style.icon, onclick: onClick }, svg({ icon }), span({ textContent: text }));
    }

    setControl(control: AsyncController | undefined) {
        this.control = control;
    }

    private readonly _onConfirm = () => {
        this.control?.success();
    };

    private readonly _onCancel = () => {
        this.control?.cancel();
    };
}

customElements.define("ok-cancel", OKCancel);
