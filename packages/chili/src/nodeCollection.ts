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
        let items = this.getItems(nodes, (node) => this.nodeMap.set(node.id, node));
        if (items.length === 0) return;
        this.document.visual.context.addModel(nodes.filter((node) => INode.isModelNode(node)) as IModel[]);
        PubSub.default.pub("nodeAdded", this.document, items);
        Transaction.add(this.document, new CollectionHistoryRecord(this, CollectionAction.add, items));
    }

    remove(...nodes: INode[]) {
        let items = this.getItems(nodes, (node) => this.nodeMap.delete(node.id));
        if (items.length === 0) return;
        this.document.visual.context.removeModel(nodes.filter((node) => INode.isModelNode(node)) as IModel[]);
        PubSub.default.pub("nodeRemoved", this.document, items);
        Transaction.add(this.document, new CollectionHistoryRecord(this, CollectionAction.remove, items));
    }

    private getItems(nodes: INode[], handleNodeAction: (node: INode) => void) {
        let items = new Array(nodes.length);
        let index = 0;
        for (const node of nodes) {
            if (this.nodeMap.has(node.id)) {
                handleNodeAction(node);
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
