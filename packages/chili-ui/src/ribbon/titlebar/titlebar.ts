// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Language } from "chili-core";
import { ComboBox, Control, Panel, Svg } from "../../components";

import { QuickToolbar } from "./quickbar";
import { Title } from "./title";
import style from "./titlebar.module.css";

export class TitleBar extends Control {
    readonly quickToolBar: QuickToolbar;
    readonly titleBar: Title;
    readonly right: HTMLElement;

    constructor() {
        super(style.root);
        this.right = new Panel();
        this.quickToolBar = new QuickToolbar();
        this.titleBar = new Title();
        this.append(this.quickToolBar, this.titleBar, this.right);
    }

    add(...controls: HTMLElement[]) {
        this.right.append(...controls);
    }
}

customElements.define("title-bar", TitleBar);
