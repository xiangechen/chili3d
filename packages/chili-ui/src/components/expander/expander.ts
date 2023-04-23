// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-core";
import { Panel } from "../panel";
import { Control } from "../control";
import { Label } from "../label";
import { Svg } from "../svg";
import style from "./expander.module.css";

export class Expander extends Control {
    private _isExpanded = true;
    private expanderIcon: Svg;
    private readonly headerPanel = new Panel(style.headerPanel);
    readonly contenxtPanel = new Panel(style.contextPanel);

    constructor(header: keyof I18n) {
        super(style.rootPanel);
        this.expanderIcon = new Svg(this.getExpanderIcon())
            .addClass(style.expanderIcon)
            .onClick(this._handleExpanderClick);
        let text = new Label().i18nText(header).addClass(style.headerText);
        this.headerPanel.append(this.expanderIcon, text);
        super.append(this.headerPanel, this.contenxtPanel);
    }

    override appendChild<T extends Node>(node: T): T {
        this.contenxtPanel.appendChild(node);
        return node;
    }

    override append(...nodes: Node[]): void {
        this.contenxtPanel.append(...nodes);
    }

    override removeChild<T extends Node>(child: T): T {
        this.contenxtPanel.removeChild(child);
        return child;
    }

    addItem(...nodes: Node[]) {
        this.append(...nodes);
        return this;
    }

    override clearChildren() {
        this.contenxtPanel.clearChildren();
    }

    private getExpanderIcon() {
        return this._isExpanded === true ? "icon-angle-down" : "icon-angle-right";
    }

    private _handleExpanderClick = () => {
        this._isExpanded = !this._isExpanded;
        this.expanderIcon.setIcon(this.getExpanderIcon());
        if (this._isExpanded) {
            this.contenxtPanel.classList.remove(style.hidden);
        } else {
            this.contenxtPanel.classList.add(style.hidden);
        }
    };
}

customElements.define("chili-expander", Expander);
