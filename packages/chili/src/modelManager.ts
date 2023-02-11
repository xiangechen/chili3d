// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CollectionAction,
    HistoryRecord,
    ICollection,
    IDocument,
    IModelManager,
    ModelCollection,
    ModelObject,
    Observable,
    PubSub,
    Transaction,
} from "chili-core";

export class ModelManager extends Observable implements IModelManager {
    readonly models: ModelCollection;

    constructor(readonly document: IDocument) {
        super();
        this.models = new ModelCollection();
        this.models.onCollectionChanged(this.handleModelCollectionChanged);
    }

    get count(): number {
        return this.models.size();
    }

    get(id: string): ModelObject | undefined {
        return this.models.get(id);
    }

    getMany(...ids: string[]): ModelObject[] {
        let result: ModelObject[] = [];
        for (const id of ids) {
            let model = this.models.get(id);
            if (model !== undefined) {
                result.push(model);
            }
        }
        return result;
    }

    add(...models: ModelObject[]) {
        models.forEach((model) => {
            this.models.add(model);
            model.setHistoryHandler(this.handleRecord);
        });
    }

    remove(...models: ModelObject[]) {
        models.forEach((model) => {
            if (ModelObject.isGroup(model)) {
                for (const it of this.models.entry()) {
                    if (it.parent === model && it instanceof ModelObject) this.remove(it);
                }
            }
            this.models.remove(model);
            model.setHistoryHandler(undefined);
        });
    }

    private handleRecord = (record: HistoryRecord) => {
        Transaction.add(this.document, record);
    };

    private handleModelCollectionChanged = (
        source: ICollection<ModelObject>,
        action: CollectionAction,
        item: ModelObject
    ) => {
        Transaction.add(this.document, {
            name: `collection ${String(action)}`,
            action,
            collection: source,
            item,
        });
        if (action === CollectionAction.add) {
            PubSub.default.pub("modelAdded", this.document, item);
        } else if (action === CollectionAction.remove) {
            PubSub.default.pub("modelRemoved", this.document, item);
        }
    };
}
