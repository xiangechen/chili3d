// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Transaction, ModelGroup, ModelObject } from "chili-core";
import { Control } from "../control";
import { ModelTree } from "./tree";
import { TreeItemBase } from "./treeItemBase";
import style from "./treeItemGroup.module.css";

export class TreeItemGroup extends TreeItemBase {
    private _root: HTMLDivElement;
    readonly expander: SVGSVGElement;
    private _isExpanded: boolean = false;
    readonly panel: HTMLDivElement;
    private _header: HTMLDivElement;

    constructor(document: IDocument, readonly tree: ModelTree, readonly group: ModelGroup, showHeader: boolean) {
        let root = Control.div();
        super(document, group, root, style.itemGroupPanel);
        this.expander = Control.svg(this.getExpanderIcon(), style.itemExpanderIcon);
        this._header = Control.div(style.itemPanel);
        this.panel = Control.div(style.itemGroupChildPanel);
        this._root = root;
        this.expander.addEventListener("click", this._handleExpanderClick);

        this.initControls();
    }

    get isExpanded() {
        return this._isExpanded;
    }

    initControls(): void {
        Control.append(this._root, this._header, this.panel);
        this._header.appendChild(this.expander);
        this._header.appendChild(this.text);
        this._header.appendChild(this.icon);
        this.setExpander(false);
    }

    setExpander(expand: boolean) {
        this._isExpanded = expand;
        Control.setSvgIcon(this.expander, this.getExpanderIcon());
        if (this._isExpanded) {
            this.panel.classList.remove(style.itemGroupChildPanelHide);
        } else {
            this.panel.classList.add(style.itemGroupChildPanelHide);
        }
    }

    protected handleVisibleClick(): void {
        Transaction.excute(this.document, "Change visible", () => {
            this.setVisible(!this.group.visible, this.group);
        });
    }

    private setVisible(visible: boolean, model: ModelObject) {
        model.visible = visible;
        if (ModelObject.isGroup(model)) {
            model.children().forEach((x) => {
                this.setVisible(visible, x);
            });
        }
    }

    private _handleExpanderClick = () => {
        this.setExpander(!this._isExpanded);
    };

    private getExpanderIcon() {
        return this._isExpanded === true ? "icon-angle-down" : "icon-angle-right";
    }

    add(control: HTMLElement) {
        this.panel.appendChild(control);
    }

    remove(control: HTMLElement): void {
        this.panel.removeChild(control);
    }

    protected handleDrop(model: ModelObject) {
        model.parent = this.group;
    }
}
