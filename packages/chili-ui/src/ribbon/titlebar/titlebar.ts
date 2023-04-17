// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, Language, PubSub } from "chili-core";
import { ComboBox, Control, Svg, Panel } from "../../components";

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

        let i18n = new Panel().addClass(style.i18n);
        let svg = new Svg("icon-i18n").addClass(style.i18nIcon);
        let select = new ComboBox(Language.Languages).addClass(style.i18nSelect);
        i18n.append(svg, select);
        this.right.append(i18n);
        select.onSelectionChanged((e: number) => {
            Language.set(e);
        });
    }

    add(...controls: HTMLElement[]) {
        this.right.append(...controls);
    }
}

customElements.define("title-bar", TitleBar);
