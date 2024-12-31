// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, INodeLinkedList } from "chili-core";
import { div, setSVGIcon, svg } from "../../components";
import { TreeItem } from "./treeItem";
import style from "./treeItemGroup.module.css";

export class TreeGroup extends TreeItem {
    private _isExpanded: boolean = true;
    readonly header: HTMLElement;
    readonly items: HTMLDivElement = div({ className: `${style.container} ${style.left16px}` });
    readonly expanderIcon: SVGSVGElement;

    constructor(document: IDocument, node: INodeLinkedList) {
        super(document, node);
        this.expanderIcon = svg({
            icon: this.getExpanderIcon(),
            className: style.expanderIcon,
            onclick: this.handleExpanderClick,
        });
        this.header = div(
            { className: `${style.row} ${style.header}` },
            this.expanderIcon,
            this.name,
            this.visibleIcon,
        );
        super.append(div({ className: style.container }, this.header, this.items));
    }

    get isExpanded(): boolean {
        return this._isExpanded;
    }

    set isExpanded(value: boolean) {
        this._isExpanded = value;
        setSVGIcon(this.expanderIcon, this.getExpanderIcon());
        if (this._isExpanded) {
            this.items.classList.remove(style.hide);
        } else {
            this.items.classList.add(style.hide);
        }
    }

    getSelectedHandler(): HTMLElement {
        return this.header;
    }

    override dispose() {
        super.dispose();
        this.expanderIcon.removeEventListener("click", this.handleExpanderClick);
    }

    private readonly handleExpanderClick = (e: MouseEvent) => {
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
        if (child.parentNode === this.items) this.items.removeChild(child);
        return child;
    }

    addItem(...items: Node[]) {
        this.items.append(...items);
        return this;
    }

    insertAfter(item: TreeItem, child: TreeItem | null): void {
        if (child === null) {
            this.items.insertBefore(item, this.items.firstChild);
        } else {
            this.items.insertBefore(item, child?.nextSibling ?? null);
        }
    }
}

customElements.define("tree-group", TreeGroup);
