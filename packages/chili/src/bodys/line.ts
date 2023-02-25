// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, I18n, IShape, property, Result, XYZ } from "chili-core";
import { Application } from "../application";

import { XYZEqualityComparer } from "../comparers";

export class LineBody extends Entity {
    private _start: XYZ;
    private _end: XYZ;
    readonly name: keyof I18n = "body.line";

    constructor(start: XYZ, end: XYZ) {
        super();
        this._start = start;
        this._end = end;
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.line(this._start, this._end);
    }

    @property("line.start")
    get start() {
        return this._start;
    }

    set start(pnt: XYZ) {
        this.setPropertyAndUpdate("start", pnt);
    }

    @property("line.end")
    get end() {
        return this._end;
    }

    set end(pnt: XYZ) {
        this.setPropertyAndUpdate("end", pnt);
    }
}
