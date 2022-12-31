// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Div, TextBlock } from "../controls";
import { RibbonGroup } from "./ribbonGroup";
import style from "./ribbon.module.css";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonButton } from "./ribbonButton";
import { RibbonStack } from "./ribbonStack";
import { RibbonTabData } from "./ribbonData";

export class RibbonTab extends Div {
    readonly header: TextBlock;

    constructor(name: string) {
        super(style.contentPanel);
        this.header = new TextBlock(name, style.tabHeader);
    }

    add(group: RibbonGroup) {
        super.add(group);
    }

    static from(config: RibbonTabData, handleCommand: (name: string) => void) {
        let tab = new RibbonTab(config.tabName);
        config.groups.forEach((g) => {
            let group = new RibbonGroup(g.groupName);
            tab.add(group);
            g.items.forEach((i) => {
                if (typeof i === "string") {
                    group.add(new RibbonButton(i, RibbonButtonSize.Normal, handleCommand));
                } else {
                    let stack = new RibbonStack();
                    i.forEach((b) => {
                        stack.add(new RibbonButton(b, RibbonButtonSize.Mini, handleCommand));
                    });
                    group.add(stack);
                }
            });
        });

        return tab;
    }
}
