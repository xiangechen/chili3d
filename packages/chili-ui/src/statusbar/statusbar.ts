// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, label } from "chili-controls";
import { I18n, I18nKeys, Localize, PubSub } from "chili-core";
import { SnapConfig } from "./snapConfig";
import style from "./statusbar.module.css";

export class Statusbar extends HTMLElement {
    readonly tip = label({
        textContent: new Localize("prompt.default"),
        className: style.tip,
    });

    constructor(className: string) {
        super();
        this.className = `${style.panel} ${className}`;

        PubSub.default.sub("statusBarTip", this.statusBarTip);
        PubSub.default.sub("clearStatusBarTip", this.clearStatusBarTip);

        this.render();
    }

    private render() {
        this.append(
            div({ className: style.left }, this.tip),
            div({ className: style.right }, new SnapConfig()),
        );
    }

    private readonly statusBarTip = (tip: I18nKeys) => {
        I18n.set(this.tip, "textContent", tip);
    };

    private readonly clearStatusBarTip = () => {
        I18n.set(this.tip, "textContent", "prompt.default");
    };
}

customElements.define("chili-statusbar", Statusbar);
