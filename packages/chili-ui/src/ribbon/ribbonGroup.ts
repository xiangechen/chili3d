// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, ObservableCollection } from "chili-core";
import { Control, Label, Panel } from "../components";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonGroupData } from "./ribbonData";

import style from "./ribbonGroup.module.css";
import { RibbonStack } from "./ribbonStack";

export class RibbonGroup extends Control {
    readonly panel: Panel;
    readonly header: Label;

    constructor(name: I18nKeys) {
        super(style.root);
        this.panel = new Panel().addClass(style.panel);
        this.header = new Label().addClass(style.header).i18nText(name);

        this.append(this.panel, this.header);
    }

    add(...controls: Control[]) {
        this.panel.append(...controls);
    }

    static from(data: RibbonGroupData) {
        let group = new RibbonGroup(data.groupName);
        let items = data.items
            .map((item) => {
                if (typeof item === "string") {
                    return RibbonButton.fromCommandName(item, RibbonButtonSize.Normal);
                } else if (item instanceof ObservableCollection) {
                    let stack = new RibbonStack();
                    item.forEach((b) => {
                        let button = RibbonButton.fromCommandName(b, RibbonButtonSize.Mini);
                        if (button) stack.append(button);
                    });
                    return stack;
                } else {
                    return new RibbonButton(item.display, item.icon, RibbonButtonSize.Normal, item.onClick);
                }
            })
            .filter((x) => x !== undefined) as Control[];
        group.add(...items);
        return group;
    }
}

customElements.define("ribbon-group", RibbonGroup);
