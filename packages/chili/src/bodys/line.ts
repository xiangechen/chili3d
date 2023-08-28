// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Body, I18nKeys, IDocument, IShape, Property, Result, Serializer, XYZ } from "chili-core";

export class LineBody extends Body {
    readonly name: I18nKeys = "body.line";

    private _start: XYZ;

    @Serializer.property("constructor")
    @Property.define("line.start")
    get start() {
        return this._start;
    }
    set start(pnt: XYZ) {
        this.setPropertyAndUpdate("start", pnt);
    }

    private _end: XYZ;

    @Serializer.property("constructor")
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

    @Serializer.deserializer()
    static from({ document, start, end }: { document: IDocument; start: XYZ; end: XYZ }) {
        return new LineBody(document, start, end);
    }

    protected generateShape(): Result<IShape, string> {
        return this.shapeFactory.line(this._start, this._end);
    }
}
