// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-shared";
import { Control } from "../control";
import style from "./ribbon.module.css";

export class RibbonGroup {
    readonly dom: HTMLDivElement;
    readonly panel: HTMLDivElement;
    readonly header: HTMLSpanElement;

    constructor(name: keyof I18n) {
        this.dom = Control.div(style.group);
        this.panel = Control.div(style.groupPanel);
        this.header = Control.span(name, style.groupHeader);

        Control.append(this.dom, this.panel, this.header);
    }

    add(...controls: HTMLElement[]) {
        Control.append(this.panel, ...controls);
    }
}
