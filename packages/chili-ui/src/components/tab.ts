// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys } from "chili-core";

import { Control, Label, Panel, Row } from ".";
import style from "./tab.module.css";

export class Tab extends Control {
    readonly itemsPanel: Panel;
    readonly toolsPanel: Panel;

    constructor(name: I18nKeys) {
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

    override clearChildren() {
        this.itemsPanel.clearChildren();
    }
}

customElements.define("chili-tab", Tab);
