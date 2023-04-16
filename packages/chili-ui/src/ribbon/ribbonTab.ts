// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, PubSub } from "chili-core";
import { Control, Label, Panel } from "../components";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonTabData } from "./ribbonData";
import { RibbonGroup } from "./ribbonGroup";
import { RibbonStack } from "./ribbonStack";
import style from "./ribbonTab.module.css";

export class RibbonTab extends Control {
    readonly header: Label;

    constructor(name: keyof I18n) {
        super(style.panel);
        this.header = new Label().addClass(style.header).i18nText(name);
    }

    add(group: RibbonGroup) {
        this.append(group);
    }

    static from(config: RibbonTabData) {
        let tab = new RibbonTab(config.tabName);
        config.groups.forEach((g) => {
            let group = RibbonGroup.from(g);
            tab.add(group);
        });

        return tab;
    }
}

customElements.define("ribbon-tab", RibbonTab);
