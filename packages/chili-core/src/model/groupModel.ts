// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Id } from "../id";
import { Model } from "./model";

export class GroupModel extends Model {
    readonly _children: Model[] = [];

    constructor(name: string, id: string = Id.new()) {
        super(name, id);
    }
    children(): Model[] {
        return this._children;
    }

    addChild(model: Model) {
        if (this._children.indexOf(model) > -1) return;
        this._children.push(model);
    }

    removeChild(model: Model) {
        let index = this._children.indexOf(model);
        if (index === -1) return;
        this._children.splice(index, 1);
    }

    protected handleTransformChanged(): void {
        throw new Error("Method not implemented.");
    }
}
