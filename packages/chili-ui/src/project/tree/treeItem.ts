// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IModel, INode, Transaction } from "chili-core";
import { Control, Label, Svg } from "../../components";
import style from "./treeItem.module.css";

export abstract class TreeItem extends Control {
    readonly name: Label;
    readonly visibleIcon: Svg;

    constructor(readonly document: IDocument, readonly node: INode) {
        super();
        this.draggable = true;
        this.name = new Label().textBinding(node, "name").addClass(style.name);
        this.visibleIcon = new Svg(this.getVisibleIcon())
            .onClick(this.onVisibleIconClick)
            .addClass(style.icon);

        node.onPropertyChanged(this.onPropertyChanged);
    }

    private onPropertyChanged = (model: INode, property: keyof INode, old: any, newValue: any) => {
        if (property === "visible") {
            this.visibleIcon.setIcon(this.getVisibleIcon());
        } else if (property === "parentVisible") {
            if (newValue) {
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

    override dispose(): void | Promise<void> {
        super.dispose();
        this.visibleIcon.removeEventListener("click", this.onVisibleIconClick);
    }

    private getVisibleIcon() {
        return this.node.visible === true ? "icon-eye" : "icon-eye-slash";
    }

    private onVisibleIconClick = (e: MouseEvent) => {
        e.stopPropagation();
        Transaction.excute(this.document, "change visible", () => {
            this.node.visible = !this.node.visible;
        });
        this.document.viewer.redraw();
    };
}
