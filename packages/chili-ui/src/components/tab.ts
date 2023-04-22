// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-core";

import { Control, Label, Row, Panel } from ".";
import style from "./tab.module.css";

export class Tab extends Control {
    readonly itemsPanel: Panel;
    readonly toolsPanel: Panel;

    constructor(name: keyof I18n) {
        super(style.root);
        let text = new Label().addClass(style.headerText).i18nText(name);
        this.toolsPanel = new Panel().addClass(style.headerTools);
        this.itemsPanel = new Panel().addClass(style.itemsContainer);
        this.append(new Row(text, this.toolsPanel), this.itemsPanel);
    }

    addTools(...items: HTMLElement[]) {
        this.toolsPanel.append(...items);
        return this;
    }

    addItem(...items: HTMLElement[]) {
        this.itemsPanel.append(...items);
        return this;
    }

    clearItems() {
        this.clearChildren(this.itemsPanel);
    }
}

customElements.define("chili-tab", Tab);
