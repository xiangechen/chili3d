// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys, PubSub } from "chili-core";
import { label, localize } from "../components";
import style from "./statusbar.module.css";

export class Statusbar extends HTMLElement {
    readonly tip = label({
        textContent: localize("prompt.default"),
        className: style.tip,
    });

    constructor(className: string) {
        super();
        this.className = `${style.panel} ${className}`;
        this.append(this.tip);
        PubSub.default.sub("statusBarTip", this.statusBarTip);
        PubSub.default.sub("clearStatusBarTip", this.clearStatusBarTip);
    }

    private statusBarTip = (tip: I18nKeys) => {
        I18n.set(this.tip, tip);
    };

    private clearStatusBarTip = () => {
        I18n.set(this.tip, "prompt.default");
    };
}

customElements.define("chili-statusbar", Statusbar);
