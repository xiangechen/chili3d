// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-shared";
import { Control } from "../control";
import style from "./tab.module.css";

export class Tab {
    readonly dom: HTMLDivElement;
    readonly panel: HTMLDivElement;
    readonly tool: HTMLDivElement;

    constructor(name: keyof I18n) {
        this.dom = Control.div(style.panel);
        let headerPanel = Control.div(style.tabHeaderPanel);
        this.panel = Control.div(style.tabBodyPanel);
        let left = Control.div(style.tabHeaderLeft);
        let textPanel = Control.div(style.tabHeaderTextPanel);
        this.tool = Control.div(style.tabHeaderRight);
        left.appendChild(textPanel);
        textPanel.appendChild(Control.span(name, style.tabHeaderText));
        Control.append(headerPanel, left, this.tool);
        Control.append(this.dom, headerPanel, this.panel);
    }

    addTools(...items: HTMLElement[]) {
        items.forEach((x) => this.tool.appendChild(x));
    }

    addItem(...items: HTMLElement[]) {
        items.forEach((x) => this.panel.appendChild(x));
    }

    clearItems() {
        Control.clear(this.panel);
    }
}
