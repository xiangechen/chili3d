// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { I18n, Language } from "chili-shared";
import { Control } from "../../control";
import { QuickToolbar } from "./quickbar";
import { Title } from "./title";
import style from "./title.module.css";

export class TitleBar {
    readonly dom: HTMLDivElement;
    readonly quickToolBar: QuickToolbar;
    readonly title: Title;
    readonly right: HTMLDivElement;

    constructor() {
        this.dom = Control.div(style.titleBarContainer);
        let left = Control.div();
        let center = Control.div();
        this.right = Control.div();
        this.quickToolBar = new QuickToolbar(left);
        this.title = new Title(center);
        Control.append(this.dom, left, center, this.right);

        let i18n = Control.div(style.i18n);
        let svg = Control.svg("icon-i18n", style.i18nIcon);
        let select = Control.select(Language.Languages, style.i18nSelect);
        i18n.appendChild(svg);
        i18n.appendChild(select);
        this.right.appendChild(i18n);
        select.addEventListener("change", (e) => {
            if (Language.set(select.selectedIndex)) {
                PubSub.default.pub("clearStatusBarTip");
            }
        });
    }

    add(...controls: HTMLElement[]) {
        Control.append(this.right, ...controls);
    }
}
