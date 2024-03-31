// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { FaceableBody, I18nKeys, IDocument, IShape, Property, Result, Serializer, XYZ } from "chili-core";

@Serializer.register("PolygonBody", ["document", "points"])
export class PolygonBody extends FaceableBody {
    readonly display: I18nKeys = "body.polygon";

    private _points: XYZ[];
    @Serializer.serialze()
    @Property.define("polygon.points")
    get points() {
        return this._points;
    }
    set points(value: XYZ[]) {
        this.setPropertyAndUpdate("points", value);
    }

    constructor(document: IDocument, points: XYZ[]) {
        super(document);
        this._points = points;
    }

    protected generateShape(): Result<IShape, string> {
        let wire = this.shapeFactory.polygon(...this._points);
        if (!wire.success || !this.isFace) return wire;
        return wire.value.toFace();
    }
}
