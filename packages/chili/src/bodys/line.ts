// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Body, Entity, I18n, IDocument, IShape, Matrix4, property, Result, XYZ } from "chili-core";
import { Application } from "chili-core/src/application";

export class LineBody extends Body {
    readonly name: keyof I18n = "body.line";
    private readonly initialStart: XYZ;
    private readonly initialEnd: XYZ;

    private _start: XYZ;
    @property("line.start")
    get start() {
        return this._start;
    }
    set start(pnt: XYZ) {
        this.setPropertyAndUpdate("start", pnt);
    }

    private _end: XYZ;
    @property("line.end")
    get end() {
        return this._end;
    }
    set end(pnt: XYZ) {
        this.setPropertyAndUpdate("end", pnt);
    }

    constructor(document: IDocument, start: XYZ, end: XYZ) {
        super(document);
        this.initialStart = start;
        this.initialEnd = end;
        this._start = start;
        this._end = end;
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.line(this._start, this._end);
    }

    override setMatrix(matrix: Matrix4): void {
        this._start = matrix.ofPoint(this.initialStart);
        this._end = matrix.ofPoint(this.initialEnd);
    }
}
