// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, I18nKeys, IDocument, IShape, Result, XYZ } from "chili-core";

export class PolygonBody extends Entity {
    private _points: XYZ[];
    readonly name: I18nKeys = "body.polygon";

    constructor(document: IDocument, ...points: XYZ[]) {
        super(document);
        this._points = points;
    }

    protected generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.polygon(...this._points);
    }
}
