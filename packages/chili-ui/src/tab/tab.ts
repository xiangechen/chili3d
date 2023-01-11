// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-shared";
import { Control } from "../control";
import style from "./tab.module.css";

export class Tab {
    readonly dom: HTMLDivElement;
    constructor(name: keyof I18n) {
        this.dom = Control.div(style.panel);
        let headerPanel = Control.div(style.tabHeaderPanel);
        let bodyPanel = Control.div(style.tabBodyPanel);
        let textPanel = Control.div(style.tabHeaderTextPanel);
        textPanel.appendChild(Control.span(name, style.tabHeaderText));
        headerPanel.appendChild(textPanel);
        Control.append(this.dom, headerPanel, bodyPanel);
    }
}
