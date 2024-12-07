// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys } from "chili-core";
import { div, label, setSVGIcon, svg } from "../controls";
import { localize } from "../localize";
import style from "./expander.module.css";

export class Expander extends HTMLElement {
    private _isExpanded = true;
    private readonly expanderIcon: SVGSVGElement;
    private readonly headerPanel = div({ className: style.headerPanel });
    readonly contenxtPanel = div({ className: style.contextPanel });

    constructor(header: I18nKeys) {
        super();
        this.className = style.rootPanel;
        this.expanderIcon = svg({
            icon: this.getExpanderIcon(),
            className: style.expanderIcon,
            onclick: this._handleExpanderClick,
        });
        let text = label({
            textContent: localize(header),
            className: style.headerText,
        });
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

    private getExpanderIcon() {
        return this._isExpanded === true ? "icon-angle-down" : "icon-angle-right";
    }

    private _handleExpanderClick = (e: MouseEvent) => {
        e.stopPropagation();
        this._isExpanded = !this._isExpanded;
        setSVGIcon(this.expanderIcon, this.getExpanderIcon());
        if (this._isExpanded) {
            this.contenxtPanel.classList.remove(style.hidden);
        } else {
            this.contenxtPanel.classList.add(style.hidden);
        }
    };
}

customElements.define("chili-expander", Expander);
