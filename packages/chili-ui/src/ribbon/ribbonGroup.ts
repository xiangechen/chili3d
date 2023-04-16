// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, PubSub } from "chili-core";
import { Control, Label, Panel } from "../components";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonGroupData } from "./ribbonData";

import style from "./ribbonGroup.module.css";
import { RibbonStack } from "./ribbonStack";

export class RibbonGroup extends Control {
    readonly panel: Panel;
    readonly header: Label;

    constructor(name: keyof I18n) {
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
        let items = data.items.map((item) => {
            if (typeof item === "string") {
                return new RibbonButton(item, RibbonButtonSize.Normal, this.handleCommand);
            } else {
                let stack = new RibbonStack();
                item.forEach((b) => {
                    stack.append(new RibbonButton(b, RibbonButtonSize.Mini, this.handleCommand));
                });
                return stack;
            }
        });
        group.add(...items);
        return group;
    }

    private static handleCommand = (name: string) => {
        PubSub.default.pub("excuteCommand", name as any);
    };
}

customElements.define("ribbon-group", RibbonGroup);
