// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Logger, NodeRecord, NodesHistoryRecord, PubSub, Transaction } from "../base";
import { IDocument } from "../document";
import { Id } from "../id";
import { ILinkListNode, IModel, INode, Node } from "./node";

export class NodeLinkedList extends Node implements ILinkListNode {
    private _count: number = 0;
    private _firstChild: INode | undefined;
    private _lastChild: INode | undefined;

    constructor(document: IDocument, name: string, id: string = Id.new()) {
        super(document, name, id);
    }

    get count() {
        return this._count;
    }

    size(): number {
        return this._count;
    }

    firstChild(): INode | undefined {
        return this._firstChild;
    }

    lastChild(): INode | undefined {
        return this._lastChild;
    }

    add(...items: INode[]): void {
        let records: NodeRecord[] = [];
        items.forEach((item) => {
            records.push({
                action: "add",
                node: item,
                oldParent: item.parent,
                newParent: this,
                oldPrevious: item.previousSibling,
                newPrevious: this._lastChild,
            });
            if (this.initParentAndAssertNotFirst(item)) {
                this.addToLast(item);
            }
            this._count++;
        });

        this.handlePubAndHistory(records);
    }

    private handlePubAndHistory(records: NodeRecord[]) {
        Transaction.add(this.document, new NodesHistoryRecord(records));
        PubSub.default.pub("nodeLinkedListChanged", records);
        Logger.debug(`NodeLinkList Changed`);
    }

    private ensureIsChild(item: INode) {
        if (item.parent !== this) {
            Logger.warn(`${item.name} is not a child node of the ${this.name} node`);
            return false;
        }
        return true;
    }

    private initParentAndAssertNotFirst(node: INode) {
        if (node.parent !== this) {
            node.parent = this;
        }
        if (this._firstChild === undefined) {
            this._firstChild = node;
            this._lastChild = node;
            node.previousSibling = undefined;
            node.nextSibling = undefined;
            return false;
        }
        return true;
    }

    private addToLast(item: INode) {
        this._lastChild!.nextSibling = item;
        item.previousSibling = this._lastChild;
        item.nextSibling = undefined;
        this._lastChild = item;
    }

    remove(...items: INode[]): void {
        let records: NodeRecord[] = [];
        items.forEach((item) => {
            if (!this.ensureIsChild(item)) return;
            records.push({
                action: "remove",
                node: item,
                newParent: undefined,
                newPrevious: undefined,
                oldParent: this,
                oldPrevious: item.previousSibling,
            });
            this.removeNode(item, true);
            this._count--;
        });
        this.handlePubAndHistory(records);
    }

    private removeNode(item: INode, nullifyParent: boolean) {
        if (nullifyParent) {
            item.parent = undefined;
        }
        if (this._firstChild === item) {
            if (this._lastChild === item) {
                this._firstChild = undefined;
                this._lastChild = undefined;
            } else {
                this._firstChild = item.nextSibling;
                this._firstChild!.previousSibling = undefined;
                item.nextSibling = undefined;
            }
        } else if (this._lastChild === item) {
            this._lastChild = item.previousSibling;
            this._lastChild!.nextSibling = undefined;
            item.previousSibling = undefined;
        } else {
            item.previousSibling!.nextSibling = item.nextSibling;
            item.nextSibling!.previousSibling = item.previousSibling;
            item.previousSibling = undefined;
            item.nextSibling = undefined;
        }
    }

    insertBefore(target: INode | undefined, node: INode): void {
        if (target !== undefined && !this.ensureIsChild(target)) return;
        let record: NodeRecord = {
            action: node.parent === undefined ? "add" : "move",
            node,
            oldParent: node.parent,
            oldPrevious: node.previousSibling,
            newParent: this,
            newPrevious: target?.previousSibling,
        };
        if (this.initParentAndAssertNotFirst(node)) {
            if (target === undefined || target === this._firstChild) {
                this._firstChild!.previousSibling = node;
                node.nextSibling = this._firstChild;
                this._firstChild = node;
            } else {
                node.previousSibling = target.previousSibling;
                node.nextSibling = target;
                target.previousSibling = node;
            }
        }
        this._count++;
        this.handlePubAndHistory([record]);
    }

    insertAfter(target: INode | undefined, node: INode): void {
        if (target !== undefined && !this.ensureIsChild(target)) return;
        let record: NodeRecord = {
            action: node.parent === undefined ? "add" : "move",
            oldParent: node.parent,
            oldPrevious: node.previousSibling,
            newParent: this,
            newPrevious: target,
            node,
        };
        if (this.initParentAndAssertNotFirst(node)) {
            if (target === undefined || target === this._lastChild) {
                this.addToLast(node);
            } else {
                node.nextSibling = target.nextSibling;
                node.previousSibling = target;
                target.nextSibling = node;
            }
        }
        this._count++;
        this.handlePubAndHistory([record]);
    }

    moveToAfter(child: INode, newParent: ILinkListNode, target?: INode | undefined): void {
        if (this.ensureIsChild(child)) {
            this.removeNode(child, false);
            this._count--;
        }
        newParent.insertAfter(target, child);
    }

    protected onVisibleChanged() {
        this.setChildrenParentVisible();
    }

    protected onParentVisibleChanged() {
        this.setChildrenParentVisible();
    }

    private setChildrenParentVisible() {
        let child = this._firstChild;
        while (child !== undefined) {
            child.parentVisible = this.visible && this.parentVisible;
            child = child.nextSibling;
        }
    }
}
