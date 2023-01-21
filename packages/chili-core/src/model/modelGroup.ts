// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ModelObject } from "./modelObject";

export class ModelGroup extends ModelObject {
    readonly _children: ModelObject[] = [];

    constructor(name: string, id: string) {
        super(id, name);
    }
    children(): ModelObject[] {
        return this._children;
    }

    addChild(model: ModelObject) {
        if (this._children.indexOf(model) > -1) return;
        this._children.push(model);
    }

    removeChild(model: ModelObject) {
        let index = this._children.indexOf(model);
        if (index === -1) return;
        this._children.splice(index, 1);
    }

    protected handlePositionChanged(): void {
        throw new Error("Method not implemented.");
    }
    protected handleRotateChanged(): void {
        throw new Error("Method not implemented.");
    }
}
