// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, Container, I18n, IShape, property, Result, Token, XYZ, editor } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { XYZEqualityComparer } from "../comparers";
import { LineEditor } from "../editors";

@editor(LineEditor)
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
        return this.create(this._start, this._end);
    }

    create(start: XYZ, end: XYZ) {
        let edgeFactory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return edgeFactory!.line(start, end);
    }

    @property("line.start")
    get start() {
        return this._start;
    }

    set start(pnt: XYZ) {
        this.setPropertyAndUpdate("start", pnt, new XYZEqualityComparer());
    }

    @property("line.end")
    get end() {
        return this._end;
    }

    set end(pnt: XYZ) {
        this.setPropertyAndUpdate("end", pnt, new XYZEqualityComparer());
    }
}
