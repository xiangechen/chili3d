// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, ILinkListNode } from "chili-core";
import { Column, Row, Svg } from "../../components";
import { TreeItem } from "./treeItem";
import style from "./treeItemGroup.module.css";

export class TreeGroup extends TreeItem {
    private _isExpanded: boolean = true;
    readonly header: Row;
    readonly items: Column = new Column().addClass(style.container);
    readonly expanderIcon: Svg;

    constructor(document: IDocument, node: ILinkListNode) {
        super(document, node);
        this.expanderIcon = new Svg(this.getExpanderIcon())
            .addClass(style.expanderIcon)
            .onClick(this.handleExpanderClick);
        this.header = new Row(this.expanderIcon, this.name, this.visibleIcon).addClass(style.header);
        super.append(new Column(this.header, this.items));
    }

    get isExpanded(): boolean {
        return this._isExpanded;
    }

    set isExpanded(value: boolean) {
        this._isExpanded = value;
        this.expanderIcon.setIcon(this.getExpanderIcon());
        if (this._isExpanded) {
            this.items.classList.remove(style.hide);
        } else {
            this.items.classList.add(style.hide);
        }
    }

    getSelectedHandler(): HTMLElement {
        return this.header;
    }

    override dispose(): void | Promise<void> {
        super.dispose();
        this.expanderIcon.removeEventListener("click", this.handleExpanderClick);
    }

    private handleExpanderClick = (e: MouseEvent) => {
        e.stopPropagation();
        this.isExpanded = !this._isExpanded;
    };

    private getExpanderIcon() {
        return this._isExpanded === true ? "icon-angle-down" : "icon-angle-right";
    }

    override appendChild<T extends Node>(node: T): T {
        this.items.appendChild(node);
        return node;
    }

    override append(...nodes: Node[]): void {
        this.items.append(...nodes);
    }

    override removeChild<T extends Node>(child: T): T {
        this.items.removeChild(child);
        return child;
    }

    addItem(...items: Node[]) {
        this.items.append(...items);
        return this;
    }

    insertAfter(item: TreeItem, child: TreeItem | null): void {
        this.items.insertBefore(item, child?.nextSibling ?? null);
    }
}

customElements.define("tree-group", TreeGroup);
