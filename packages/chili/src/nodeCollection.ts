// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    PubSub,
    Transaction,
    IDocument,
    IModel,
    INode,
    CollectionAction,
    INodeCollection,
    CollectionHistoryRecord,
} from "chili-core";

export class NodeCollection implements INodeCollection {
    private readonly nodeMap: Map<string, INode> = new Map();

    constructor(readonly document: IDocument) {}

    get(id: string): INode | undefined {
        return this.nodeMap.get(id);
    }

    add(...nodes: INode[]) {
        let items = this.addNodes(nodes);
        if (items.length === 0) return;
        this.document.visual.context.addModel(nodes.filter((node) => INode.isModelNode(node)) as IModel[]);
        PubSub.default.pub("nodeAdded", this.document, items);
        Transaction.add(this.document, new CollectionHistoryRecord(this, CollectionAction.add, items));
    }

    private addNodes(nodes: INode[]) {
        let items = new Array(nodes.length);
        let index = 0;
        for (const node of nodes) {
            if (!this.nodeMap.has(node.id)) {
                this.nodeMap.set(node.id, node);
                items[index++] = node;
            }
        }
        items.splice(index);
        return items;
    }

    remove(...nodes: INode[]) {
        let items = this.removeNodes(nodes);
        if (items.length === 0) return;
        this.document.visual.context.removeModel(nodes.filter((node) => INode.isModelNode(node)) as IModel[]);
        PubSub.default.pub("nodeRemoved", this.document, items);
        Transaction.add(this.document, new CollectionHistoryRecord(this, CollectionAction.remove, items));
    }

    private removeNodes(nodes: INode[]) {
        let items: INode[] = new Array(nodes.length);
        let index = 0;
        for (const node of nodes) {
            if (this.nodeMap.has(node.id)) {
                this.nodeMap.delete(node.id);
                items[index++] = node;
            }
        }
        items.splice(index);
        return items;
    }

    find(predicate: (item: INode) => boolean): INode | undefined {
        for (let item of this.nodeMap.values()) {
            if (predicate(item)) return item;
        }
        return undefined;
    }

    entry(): IterableIterator<INode> {
        return this.nodeMap.values();
    }

    size(): number {
        return this.nodeMap.size;
    }
}
