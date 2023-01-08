// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { i18n } from "chili-shared";
import { Control } from "../control";
import style from "./statusbar.module.css";

export class Statusbar {
    readonly dom: HTMLDivElement;
    readonly tip = Control.span("tip.default", style.tip);

    constructor() {
        this.dom = Control.div(style.panel);
        this.dom.appendChild(this.tip);
        PubSub.default.sub("statusBarTip", this.statusBarTip);
        PubSub.default.sub("clearStatusBarTip", this.clearStatusBarTip);
    }

    private statusBarTip = (tip: string) => {
        this.tip.textContent = tip;
    };

    private clearStatusBarTip = () => {
        this.tip.textContent = i18n["tip.default"];
    };
}
