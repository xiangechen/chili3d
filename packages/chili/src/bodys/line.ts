// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    I18nKeys,
    IDocument,
    IShape,
    ParameterGeometry,
    Property,
    Result,
    Serializer,
    XYZ,
} from "chili-core";

@Serializer.register("LineBody", ["document", "start", "end"])
export class LineBody extends ParameterGeometry {
    readonly display: I18nKeys = "body.line";

    private _start: XYZ;

    @Serializer.serialze()
    @Property.define("line.start")
    get start() {
        return this._start;
    }
    set start(pnt: XYZ) {
        this.setPropertyAndUpdate("start", pnt);
    }

    private _end: XYZ;

    @Serializer.serialze()
    @Property.define("line.end")
    get end() {
        return this._end;
    }
    set end(pnt: XYZ) {
        this.setPropertyAndUpdate("end", pnt);
    }

    constructor(document: IDocument, start: XYZ, end: XYZ) {
        super(document);
        this._start = start;
        this._end = end;
    }

    protected generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.line(this._start, this._end);
    }
}
