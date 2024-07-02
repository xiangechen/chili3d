// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    FacebaseParameterBody,
    I18nKeys,
    IDocument,
    IShape,
    Property,
    Result,
    Serializer,
    XYZ,
} from "chili-core";

@Serializer.register(["document", "points"])
export class PolygonBody extends FacebaseParameterBody {
    readonly display: I18nKeys = "body.polygon";

    private _points: XYZ[];
    @Serializer.serialze()
    @Property.define("polygon.points")
    get points() {
        return this._points;
    }
    set points(value: XYZ[]) {
        this.setProperty("points", value);
    }

    constructor(document: IDocument, points: XYZ[]) {
        super(document);
        this._points = points;
    }

    generateShape(): Result<IShape, string> {
        let wire = this.document.application.shapeFactory.polygon(...this._points);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }
}
