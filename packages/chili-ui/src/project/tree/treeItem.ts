// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding, IDocument, INode, Transaction } from "chili-core";
import { label, setSVGIcon, svg } from "../../components";
import style from "./treeItem.module.css";

export abstract class TreeItem extends HTMLElement {
    readonly name: HTMLLabelElement;
    readonly visibleIcon: SVGSVGElement;

    constructor(
        readonly document: IDocument,
        readonly node: INode,
    ) {
        super();
        this.draggable = true;
        this.name = label({
            className: style.name,
            textContent: new Binding(node, "name"),
        });
        this.visibleIcon = svg({
            className: style.icon,
            icon: this.getVisibleIcon(),
            onclick: this.onVisibleIconClick,
        });
    }

    connectedCallback(): void {
        this.node.onPropertyChanged(this.onPropertyChanged);
    }

    disconnectedCallback(): void {
        this.node.removePropertyChanged(this.onPropertyChanged);
    }

    private readonly onPropertyChanged = (property: keyof INode, model: INode) => {
        if (property === "visible") {
            setSVGIcon(this.visibleIcon, this.getVisibleIcon());
        } else if (property === "parentVisible") {
            if (model[property]) {
                this.visibleIcon.classList.remove(style["parent-visible"]);
            } else {
                this.visibleIcon.classList.add(style["parent-visible"]);
            }
        }
    };

    addSelectedStyle(style: string) {
        this.getSelectedHandler().classList.add(style);
    }

    removeSelectedStyle(style: string) {
        this.getSelectedHandler().classList.remove(style);
    }

    abstract getSelectedHandler(): HTMLElement;

    dispose() {
        this.node.removePropertyChanged(this.onPropertyChanged);
        this.visibleIcon.removeEventListener("click", this.onVisibleIconClick);
    }

    private getVisibleIcon() {
        return this.node.visible === true ? "icon-eye" : "icon-eye-slash";
    }

    private readonly onVisibleIconClick = (e: MouseEvent) => {
        e.stopPropagation();
        Transaction.excute(this.document, "change visible", () => {
            this.node.visible = !this.node.visible;
        });
        this.document.visual.update();
    };
}
