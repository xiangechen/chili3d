// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control, Div, TextBlock } from "../controls";
import style from "./ribbon.module.css";

export class RibbonGroup extends Div {
    readonly panel: Div;
    readonly header: TextBlock;

    constructor(name: string) {
        super(style.group);
        this.panel = new Div(style.groupPanel);
        this.header = new TextBlock(name, style.groupHeader);

        super.add(this.panel, this.header);
    }

    add(...controls: Control[]) {
        controls.forEach((c) => {
            this.panel.add(c);
        });
    }
}
