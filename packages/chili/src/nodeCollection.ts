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
    private readonly modelMap: Map<string, INode> = new Map();

    constructor(readonly document: IDocument) {}

    get(id: string): INode | undefined {
        return this.modelMap.get(id);
    }

    add(...models: INode[]) {
        let index = 0;
        let items = new Array(models.length);
        for (const model of models) {
            if (!this.modelMap.has(model.id)) {
                this.modelMap.set(model.id, model);
                items[index++] = model;
            }
        }
        if (index === 0) return;
        items.splice(index);
        Transaction.add(this.document, new CollectionHistoryRecord(this, CollectionAction.add, items));
        PubSub.default.pub("nodeAdded", this.document, items);
    }

    remove(...models: IModel[]) {
        let index = 0;
        let items = new Array(models.length);
        for (const model of models) {
            if (this.modelMap.has(model.id)) {
                this.modelMap.delete(model.id);
                items[index++] = model;
            }
        }
        if (index === 0) return;
        items.splice(index);
        Transaction.add(this.document, new CollectionHistoryRecord(this, CollectionAction.remove, items));
        PubSub.default.pub("nodeRemoved", this.document, items);
    }

    find(predicate: (item: INode) => boolean): INode | undefined {
        for (let item of this.modelMap.values()) {
            if (predicate(item)) return item;
        }
        return undefined;
    }

    entry(): IterableIterator<INode> {
        return this.modelMap.values();
    }

    size(): number {
        return this.modelMap.size;
    }
}
