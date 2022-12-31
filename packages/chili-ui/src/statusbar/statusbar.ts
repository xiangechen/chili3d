// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { Div, TextBlock } from "../controls";
import style from "./statusbar.module.css";

const DefaultTip = "鼠标中键平移视图，右键旋转视图，中键滚动缩放视图";

export class Statusbar extends Div {
    readonly textblock = new TextBlock(DefaultTip, style.tip);

    constructor() {
        super(style.panel);
        this.add(this.textblock);
        PubSub.default.sub("showTip", this.showTip);
        PubSub.default.sub("clearTip", this.clearTip);
    }

    private showTip = (tip: string) => {
        this.textblock.text = tip;
    };

    private clearTip = () => {
        this.textblock.text = DefaultTip;
    };
}
