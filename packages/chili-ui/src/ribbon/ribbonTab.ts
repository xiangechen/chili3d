// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../control";
import { RibbonGroup } from "./ribbonGroup";
import style from "./ribbon.module.css";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonButton } from "./ribbonButton";
import { RibbonStack } from "./ribbonStack";
import { RibbonTabData } from "./ribbonData";

export class RibbonTab {
    readonly dom: HTMLDivElement;
    readonly header: HTMLSpanElement;

    constructor(name: string) {
        this.dom = Control.div(style.contentPanel);
        this.header = Control.span(name, style.tabHeader);
    }

    add(group: RibbonGroup) {
        this.dom.appendChild(group.dom);
    }

    static from(config: RibbonTabData, handleCommand: (name: string) => void) {
        let tab = new RibbonTab(config.tabName);
        config.groups.forEach((g) => {
            let group = new RibbonGroup(g.groupName);
            tab.add(group);
            g.items.forEach((i) => {
                if (typeof i === "string") {
                    group.add(new RibbonButton(i, RibbonButtonSize.Normal, handleCommand).dom);
                } else {
                    let stack = new RibbonStack();
                    i.forEach((b) => {
                        stack.dom.appendChild(new RibbonButton(b, RibbonButtonSize.Mini, handleCommand).dom);
                    });
                    group.add(stack.dom);
                }
            });
        });

        return tab;
    }
}
