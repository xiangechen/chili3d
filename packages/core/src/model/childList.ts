// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Logger, type NodeRecord } from "../foundation";
import type { INode, INodeLinkedList } from "./node";

type ChildOwner = INodeLinkedList & { readonly document: IDocument };

/**
 * Linked-list child management behind `INodeLinkedList`, shared by container nodes
 * (FolderNode, ParametricBodyNode). `childParentVisible` decides the visibility
 * children inherit: folders propagate their own visibility, while a parametric
 * body always hides its children (consumed boolean tools) from the scene.
 */
export class NodeChildList {
    private static readonly registry = new WeakMap<INodeLinkedList, NodeChildList>();

    static of(node: INodeLinkedList): NodeChildList | undefined {
        return NodeChildList.registry.get(node);
    }

    private _count: number = 0;
    private _firstChild: INode | undefined;
    private _lastChild: INode | undefined;

    constructor(
        private readonly owner: ChildOwner,
        private readonly childParentVisible: () => boolean,
    ) {
        NodeChildList.registry.set(owner, this);
    }

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

    children(): INode[] {
        const result: INode[] = [];
        let node = this._firstChild;
        while (node) {
            result.push(node);
            node = node.nextSibling;
        }
        return result;
    }

    add(...items: INode[]): void {
        // newPrevious is computed per item (not once up front) so records match the
        // actual sibling order when several nodes are added in one call.
        const records: NodeRecord[] = [];
        items.forEach((item) => {
            records.push({
                action: "add",
                node: item,
                oldParent: undefined,
                oldPrevious: undefined,
                newParent: this.owner,
                newPrevious: this._lastChild,
            });
            if (this.initNode(item)) {
                this.addToLast(item);
            }
            this._count++;
        });

        this.notify(records);
    }

    remove(...items: INode[]): void {
        const records = items
            .filter((item) => this.validateChild(item))
            .map(
                (item) =>
                    ({
                        action: "remove",
                        node: item,
                        newParent: undefined,
                        newPrevious: undefined,
                        oldParent: this.owner,
                        oldPrevious: item.previousSibling,
                    }) satisfies NodeRecord,
            );

        records.forEach((record) => this.removeNode(record.node, true));
        this.notify(records);
    }

    transfer(...items: INode[]): void {
        const records = items
            .filter((item) => this.validateChild(item))
            .map(
                (item) =>
                    ({
                        action: "transfer",
                        node: item,
                        newParent: undefined,
                        newPrevious: undefined,
                        oldParent: this.owner,
                        oldPrevious: item.previousSibling,
                    }) satisfies NodeRecord,
            );

        records.forEach((record) => this.removeNode(record.node, true));
        this.notify(records);
    }

    insertBefore(target: INode | undefined, node: INode): void {
        if (target && !this.validateChild(target)) return;

        const record = {
            action: "insertBefore",
            node,
            oldParent: undefined,
            oldPrevious: undefined,
            newParent: this.owner,
            newPrevious: target?.previousSibling,
        } satisfies NodeRecord;

        if (this.initNode(node)) {
            if (!target || target === this._firstChild) {
                this.insertAsFirst(node);
            } else {
                this.insertBetweenNodes(target.previousSibling!, node, target);
            }
        }
        this._count++;
        this.notify([record]);
    }

    insertAfter(target: INode | undefined, node: INode): void {
        if (target && !this.validateChild(target)) return;

        const record = {
            action: "insertAfter",
            oldParent: undefined,
            oldPrevious: undefined,
            newParent: this.owner,
            newPrevious: target,
            node,
        } satisfies NodeRecord;

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
        this.notify([record]);
    }

    /** Moves `child` (currently owned by this list) into the list of `newParent`. */
    move(child: INode, newParent: INodeLinkedList, previousSibling?: INode): void {
        const target = this.validateMove(child, newParent, previousSibling);
        if (target === undefined) return;

        const record = {
            action: "move",
            oldParent: child.parent,
            oldPrevious: child.previousSibling,
            newParent: newParent,
            newPrevious: previousSibling,
            node: child,
        } satisfies NodeRecord;

        this.removeNode(child, false);
        this.attachChild(target, child, previousSibling);

        this.notify([record]);
    }

    /** Returns the destination list, or undefined (after warning) when the move is illegal. */
    private validateMove(
        child: INode,
        newParent: INodeLinkedList,
        previousSibling?: INode,
    ): NodeChildList | undefined {
        if (!this.validateChild(child)) return undefined;

        if (previousSibling === child) {
            Logger.warn(`Cannot move ${child.name} relative to itself`);
            return undefined;
        }

        let ancestor: INode | undefined = newParent;
        while (ancestor !== undefined) {
            if (ancestor === child) {
                Logger.warn(`Cannot move ${child.name} into itself or its descendant`);
                return undefined;
            }
            ancestor = ancestor.parent;
        }

        if (previousSibling && previousSibling.parent !== newParent) {
            Logger.warn(`${previousSibling.name} is not a child node of the ${newParent.name} node`);
            return undefined;
        }

        const target = NodeChildList.of(newParent);
        if (target === undefined) {
            Logger.warn(`${newParent.name} is not a linked-list node`);
        }
        return target;
    }

    private attachChild(target: NodeChildList, child: INode, previousSibling?: INode): void {
        if (target.initNode(child)) {
            if (!previousSibling) {
                target.insertAsFirst(child);
            } else if (previousSibling === target._lastChild) {
                target.addToLast(child);
            } else {
                target.insertBetweenNodes(previousSibling, child, previousSibling.nextSibling!);
            }
        }
        target._count++;
    }

    /** Disposes every child; each child cascades to its own children via disposeInternal. */
    dispose(): void {
        let node = this._firstChild;
        while (node) {
            const next = node.nextSibling;
            node.previousSibling = undefined;
            node.nextSibling = undefined;
            node.dispose();
            node = next;
        }
        this._firstChild = this._lastChild = undefined;
        this._count = 0;
    }

    setChildrenParentVisible(): void {
        let child = this._firstChild;
        while (child !== undefined) {
            child.parentVisible = this.childParentVisible();
            child = child.nextSibling;
        }
    }

    private initNode(node: INode): boolean {
        node.parent = this.owner;
        node.parentVisible = this.childParentVisible();
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

    private validateChild(item: INode): boolean {
        if (item.parent !== this.owner) {
            Logger.warn(`${item.name} is not a child node of the ${this.owner.name} node`);
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

    private notify(records: NodeRecord[]) {
        this.owner.document.modelManager.notifyNodeChanged(records);
    }
}
