// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { Control } from "../control";
import style from "./statusbar.module.css";

const DefaultTip = "鼠标中键平移视图，右键旋转视图，中键滚动缩放视图";

export class Statusbar {
    readonly dom: HTMLDivElement;
    readonly tip = Control.span(DefaultTip, style.tip);

    constructor() {
        this.dom = Control.div(style.panel);
        this.dom.appendChild(this.tip);
        PubSub.default.sub("showTip", this.showTip);
        PubSub.default.sub("clearTip", this.clearTip);
    }

    private showTip = (tip: string) => {
        this.tip.textContent = tip;
    };

    private clearTip = () => {
        this.tip.textContent = DefaultTip;
    };
}
