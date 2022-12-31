// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { IModelGroup, IModelObject } from "chili-geo";
import { Control, Div, Svg } from "../controls";
import { ModelTree } from "./tree";
import { TreeItemBase } from "./treeItemBase";
import style from "./treeItemGroup.module.css";

export class TreeItemGroup extends TreeItemBase {
    private _root: Div;
    readonly expander: Svg;
    private _isExpanded: boolean = false;
    readonly panel: Div;
    private _header: Div;

    constructor(document: IDocument, readonly tree: ModelTree, readonly group: IModelGroup, showHeader: boolean) {
        let root = new Div();
        super(document, group, root, style.itemGroupPanel);
        this.expander = new Svg(this.getExpanderIcon(), style.itemExpanderIcon);
        this._header = new Div(style.itemPanel);
        this.panel = new Div(style.itemGroupChildPanel);
        this._root = root;
        this.expander.dom.addEventListener("click", this._handleExpanderClick);

        this.initControls();
    }

    get isExpanded() {
        return this._isExpanded;
    }

    initControls(): void {
        this._root.add(this._header, this.panel);
        this._header.dom.appendChild(this.expander.dom);
        this._header.dom.appendChild(this.text.dom);
        this._header.dom.appendChild(this.icon.dom);
        this.setExpander(false);
    }

    setExpander(expand: boolean) {
        this._isExpanded = expand;
        this.expander.setIcon(this.getExpanderIcon());
        if (this._isExpanded) {
            this.panel.removeClass(style.itemGroupChildPanelHide);
        } else {
            this.panel.addClass(style.itemGroupChildPanelHide);
        }
    }

    protected handleVisibleClick(): void {
        this.setVisible(!this.group.visible, this.group);
    }

    private setVisible(visible: boolean, model: IModelObject) {
        model.visible = visible;
        if (IModelObject.isGroup(model)) {
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

    add(control: Control) {
        this.panel.add(control);
    }

    remove(control: Control): void {
        this.panel.remove(control);
    }

    protected handleDrop(model: IModelObject) {
        model.parentId = this.group.id;
    }
}
