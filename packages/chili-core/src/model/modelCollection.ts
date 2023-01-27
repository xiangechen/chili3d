// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CollectionAction, CollectionChangedBase, ICollection } from "../observer";
import { ModelObject } from "./modelObject";

export class ModelCollection extends CollectionChangedBase<ModelObject> implements ICollection<ModelObject> {
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

    find(predicate: (item: ModelObject) => boolean): ModelObject | undefined {
        for (let item of this._map.values()) {
            if (predicate(item)) return item;
        }
        return undefined;
    }

    entry(): IterableIterator<ModelObject> {
        return this._map.values();
    }

    size(): number {
        return this._map.size;
    }
}
