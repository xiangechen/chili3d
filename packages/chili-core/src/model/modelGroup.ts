// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModelGroup, IModelObject } from "chili-geo";
import { ModelBase } from "./modelBase";

export class ModelGroup extends ModelBase implements IModelGroup {
    readonly _children: IModelObject[] = [];

    constructor(name: string, id: string) {
        super(id, name);
    }
    children(): IModelObject[] {
        return this._children;
    }

    addChild(model: IModelObject) {
        if (this._children.indexOf(model) > -1) return;
        this._children.push(model);
    }

    removeChild(model: IModelObject) {
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
