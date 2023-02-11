// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, I18n, IShape, property, Result, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { XYZEqualityComparer } from "../comparers";
import { BodyBase } from "./base";

export class LineBody extends BodyBase {
    private _start: XYZ;
    private _end: XYZ;
    readonly name: keyof I18n = "body.line";

    constructor(start: XYZ, end: XYZ) {
        super();
        this._start = start;
        this._end = end;
    }

    protected generateBody(): Result<IShape, string> {
        let edgeFactory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return edgeFactory!.line(this._start, this._end);
    }

    @property("line.start")
    get start() {
        return this._start;
    }

    set start(pnt: XYZ) {
        this.setPropertyAndUpdateBody("start", pnt, new XYZEqualityComparer());
    }

    @property("line.end")
    get end() {
        return this._end;
    }

    set end(pnt: XYZ) {
        this.setPropertyAndUpdateBody("end", pnt, new XYZEqualityComparer());
    }
}
