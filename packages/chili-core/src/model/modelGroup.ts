// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModelGroup, IModelObject } from "chili-geo";
import { IDocument } from "../interfaces";
import { ModelBase } from "./modelBase";

export class ModelGroup extends ModelBase implements IModelGroup {
    constructor(document: IDocument, name: string, id: string) {
        super(document, id, name);
        document.addModel(this);
    }
    protected handlePositionChanged(): void {
        throw new Error("Method not implemented.");
    }
    protected handleRotateChanged(): void {
        throw new Error("Method not implemented.");
    }
    children(): IModelObject[] {
        return this.document.getChildren(this.id);
    }
}
