// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, PubSub } from "chili-core";
import { Control, Label } from "../components";

import style from "./statusbar.module.css";

export class Statusbar extends Control {
    readonly tip = new Label().i18nText("tip.default").addClass(style.tip);

    constructor() {
        super(style.panel);
        this.append(this.tip);
        PubSub.default.sub("statusBarTip", this.statusBarTip);
        PubSub.default.sub("clearStatusBarTip", this.clearStatusBarTip);
    }

    private statusBarTip = (tip: keyof I18n) => {
        this.tip.i18nText(tip);
    };

    private clearStatusBarTip = () => {
        this.tip.i18nText("tip.default");
    };
}

customElements.define("chili-statusbar", Statusbar);
