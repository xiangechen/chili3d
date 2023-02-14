// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, I18n, IShape, Result, XYZ } from "chili-core";
import { Application } from "../application";

export class PolygonBody extends Entity {
    private _points: XYZ[];
    readonly name: keyof I18n = "body.polygon";

    constructor(...points: XYZ[]) {
        super();
        this._points = points;
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.polygon(...this._points);
    }
}
