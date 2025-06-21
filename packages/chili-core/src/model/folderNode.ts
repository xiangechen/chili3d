// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { Id, Logger, NodeAction } from "../foundation";
import { Serializer } from "../serialize";
import { INode, INodeLinkedList, Node } from "./node";

@Serializer.register(["document", "name", "id"])
export class FolderNode extends Node implements INodeLinkedList {
    private _count: number = 0;
    private _firstChild: INode | undefined;
    private _lastChild: INode | undefined;

    get firstChild() {
        return this._firstChild;
    }
    get lastChild() {
        return this._lastChild;
    }
    get count() {
        return this._count;
    }
    size(): number {
        return this._count;
    }

    constructor(document: IDocument, name: string, id: string = Id.generate()) {
        super(document, name, id);
    }

    add(...items: INode[]): void {
        const records = items.map((item) => ({
            action: NodeAction.add,
            node: item,
            oldParent: undefined,
            oldPrevious: undefined,
            newParent: this,
            newPrevious: this._lastChild,
        }));

        items.forEach((item) => {
            if (this.initNode(item)) {
                this.addToLast(item);
            }
            this._count++;
        });

        this.document.notifyNodeChanged(records);
    }

    private initNode(node: INode): boolean {
        node.parent = this;
        node.parentVisible = this.visible && this.parentVisible;
        if (!this._firstChild) {
            this._firstChild = this._lastChild = node;
            node.previousSibling = node.nextSibling = undefined;
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

    children(): INode[] {
        const result: INode[] = [];
        let node = this._firstChild;
        while (node) {
            result.push(node);
            node = node.nextSibling;
        }
        return result;
    }

    remove(...items: INode[]): void {
        const records = items
            .filter((item) => this.validateChild(item))
            .map((item) => ({
                action: NodeAction.remove,
                node: item,
                newParent: undefined,
                newPrevious: undefined,
                oldParent: this,
                oldPrevious: item.previousSibling,
            }));

        records.forEach((record) => this.removeNode(record.node, true));
        this.document.notifyNodeChanged(records);
    }

    transfer(...items: INode[]): void {
        const records = items
            .filter((item) => this.validateChild(item))
            .map((item) => ({
                action: NodeAction.transfer,
                node: item,
                newParent: undefined,
                newPrevious: undefined,
                oldParent: this,
                oldPrevious: item.previousSibling,
            }));

        records.forEach((record) => this.removeNode(record.node, true));
        this.document.notifyNodeChanged(records);
    }

    private validateChild(item: INode): boolean {
        if (item.parent !== this) {
            Logger.warn(`${item.name} is not a child node of the ${this.name} node`);
            return false;
        }
        return true;
    }

    private removeNode(node: INode, nullifyParent: boolean) {
        if (nullifyParent) {
            node.parent = undefined;
            node.parentVisible = true;
        }

        if (node === this._firstChild) {
            this.removeFirstNode(node);
        } else if (node === this._lastChild) {
            this.removeLastNode(node);
        } else {
            this.removeMiddleNode(node);
        }
        this._count--;
    }

    private removeFirstNode(node: INode) {
        if (node === this._lastChild) {
            this._firstChild = this._lastChild = undefined;
        } else {
            this._firstChild = node.nextSibling;
            this._firstChild!.previousSibling = undefined;
            node.nextSibling = undefined;
        }
    }

    private removeLastNode(node: INode) {
        this._lastChild = node.previousSibling;
        this._lastChild!.nextSibling = undefined;
        node.previousSibling = undefined;
    }

    private removeMiddleNode(node: INode) {
        node.previousSibling!.nextSibling = node.nextSibling;
        node.nextSibling!.previousSibling = node.previousSibling;
        node.previousSibling = node.nextSibling = undefined;
    }

    insertBefore(target: INode | undefined, node: INode): void {
        if (target && !this.validateChild(target)) return;

        const record = {
            action: NodeAction.insertBefore,
            node,
            oldParent: undefined,
            oldPrevious: undefined,
            newParent: this,
            newPrevious: target?.previousSibling,
        };

        if (this.initNode(node)) {
            if (!target || target === this._firstChild) {
                this.insertAsFirst(node);
            } else {
                this.insertBetweenNodes(target.previousSibling!, node, target);
            }
        }
        this._count++;
        this.document.notifyNodeChanged([record]);
    }

    private insertAsFirst(node: INode) {
        this._firstChild!.previousSibling = node;
        node.nextSibling = this._firstChild;
        this._firstChild = node;
    }

    private insertBetweenNodes(prev: INode, node: INode, next: INode) {
        prev.nextSibling = node;
        node.previousSibling = prev;
        node.nextSibling = next;
        next.previousSibling = node;
    }

    insertAfter(target: INode | undefined, node: INode): void {
        if (target && !this.validateChild(target)) return;

        const record = {
            action: NodeAction.insertAfter,
            oldParent: undefined,
            oldPrevious: undefined,
            newParent: this,
            newPrevious: target,
            node,
        };

        if (this.initNode(node)) {
            if (!target) {
                this.insertAsFirst(node);
            } else if (target === this._lastChild) {
                this.addToLast(node);
            } else {
                this.insertBetweenNodes(target, node, target.nextSibling!);
            }
        }
        this._count++;
        this.document.notifyNodeChanged([record]);
    }

    move(child: INode, newParent: FolderNode, previousSibling?: INode): void {
        if (previousSibling && previousSibling.parent !== newParent) {
            Logger.warn(`${previousSibling.name} is not a child node of the ${newParent.name} node`);
            return;
        }

        const record = {
            action: NodeAction.move,
            oldParent: child.parent,
            oldPrevious: child.previousSibling,
            newParent: newParent,
            newPrevious: previousSibling,
            node: child,
        };

        this.removeNode(child, false);

        if (newParent.initNode(child)) {
            if (!previousSibling) {
                newParent.insertAsFirst(child);
            } else if (previousSibling === newParent._lastChild) {
                newParent.addToLast(child);
            } else {
                newParent.insertBetweenNodes(previousSibling, child, previousSibling.nextSibling!);
            }
        }
        newParent._count++;

        this.document.notifyNodeChanged([record]);
    }

    override disposeInternal(): void {
        this.disposeNodes(this._firstChild);
        super.disposeInternal();
    }

    private readonly disposeNodes = (node: INode | undefined) => {
        if (node instanceof FolderNode) {
            this.disposeNodes(node.firstChild);
        }

        let next = node?.nextSibling;
        if (node) {
            node.nextSibling = null as any;
        }
        while (next) {
            let cache = next.nextSibling;
            next.previousSibling = null as any;
            next.nextSibling = null as any;
            next.dispose();
            next = cache;
        }
        node?.dispose();
    };

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
