// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModelObject } from "chili-geo";
import { CollectionAction, CollectionChangedBase, ICollection } from "chili-shared";
import { IDocument } from "../document";
import { ModelObject } from "./modelObject";

export class ModelCollection extends CollectionChangedBase<IModelObject> implements ICollection<IModelObject> {
    private readonly _map: Map<string, ModelObject>;

    constructor() {
        super();
        this._map = new Map();
    }

    get(id: string): ModelObject | undefined {
        return this._map.get(id);
    }

    add(item: ModelObject): boolean {
        if (this._map.has(item.id)) return false;
        this._map.set(item.id, item);
        this.emitCollectionChanged(CollectionAction.add, item);
        return true;
    }

    remove(item: ModelObject): boolean {
        if (this._map.has(item.id)) {
            this._map.delete(item.id);
            this.emitCollectionChanged(CollectionAction.remove, item);
            return true;
        }
        return false;
    }

    find(predicate: (item: IModelObject) => boolean): IModelObject | undefined {
        for (let item of this._map.values()) {
            if (predicate(item)) return item;
        }
        return undefined;
    }

    entry(): IterableIterator<IModelObject> {
        return this._map.values();
    }

    size(): number {
        return this._map.size;
    }
}
