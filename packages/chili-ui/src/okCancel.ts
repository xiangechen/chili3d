// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, span, svg } from "chili-controls";
import { AsyncController, I18nKeys, Localize } from "chili-core";
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
            span({ textContent: new Localize("ribbon.group.selection") }),
            div({ className: style.spacer }),
            this.buttons(),
        );
    }

    private buttons() {
        return div(
            { className: style.panel },
            this._createIcon("icon-confirm", "common.confirm", this._onConfirm),
            this._createIcon("icon-cancel", "common.cancel", this._onCancel),
        );
    }

    private _createIcon(icon: string, text: I18nKeys, onClick: () => void) {
        return div(
            {
                className: style.icon,
                onclick: onClick,
            },
            svg({ icon }),
            span({ textContent: new Localize(text) }),
        );
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
