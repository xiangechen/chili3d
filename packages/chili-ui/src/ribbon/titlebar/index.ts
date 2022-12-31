// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control, Div } from "../../controls";
import { QuickToolbar } from "./quickbar";
import { Title } from "./title";
import style from "./title.module.css";

export class TitleBar extends Div {
    readonly quickToolBar: QuickToolbar;
    readonly title: Title;
    readonly right: Div;

    constructor() {
        super(style.titleBarContainer);
        let left = new Div();
        let center = new Div();
        this.right = new Div();
        this.quickToolBar = new QuickToolbar(left);
        this.title = new Title(center);
        super.add(left, center, this.right);
    }

    add(...controls: Control[]) {
        this.right.add(...controls);
    }
}
