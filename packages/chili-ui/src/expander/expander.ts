// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-shared";
import { Control } from "../control";
import style from "./expander.module.css";

export class Expander {
    private _isExpanded = true;
    private svg: SVGSVGElement;
    readonly rootPanel = Control.div(style.rootPanel);
    private readonly headerPanel = Control.div(style.headerPanel);
    private readonly contenxtPanel = Control.div(style.contextPanel);

    constructor(header: keyof I18n) {
        this.svg = Control.svg(this.getExpanderIcon(), style.expanderIcon);
        let text = Control.span(header, style.headerText);
        this.headerPanel.appendChild(this.svg);
        this.headerPanel.appendChild(text);
        Control.append(this.rootPanel, this.headerPanel, this.contenxtPanel);

        this.headerPanel.addEventListener("click", this._handleExpanderClick);
    }

    addContext(...items: HTMLElement[]) {
        items.forEach((x) => this.contenxtPanel.appendChild(x));
    }

    removeContext(...items: HTMLElement[]) {
        items.forEach((x) => this.contenxtPanel.removeChild(x));
    }

    clearContext() {
        Control.clear(this.contenxtPanel);
    }

    private getExpanderIcon() {
        return this._isExpanded === true ? "icon-angle-down" : "icon-angle-right";
    }

    private _handleExpanderClick = () => {
        this._isExpanded = !this._isExpanded;
        Control.setSvgIcon(this.svg, this.getExpanderIcon());
        if (this._isExpanded) {
            this.contenxtPanel.classList.remove(style.hidden);
        } else {
            this.contenxtPanel.classList.add(style.hidden);
        }
    };
}
