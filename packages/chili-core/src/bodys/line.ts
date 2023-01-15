// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, i18n, Token, Precision, XYZ, XYZConverter, I18n, Result } from "chili-shared";
import { IBody, IEdge, IShapeFactory, IShape } from "chili-geo";
import { property } from "../decorators";
import { BodyBase } from "./base";

export class LineBody extends BodyBase {
    private _start: XYZ;
    private _end: XYZ;
    readonly name: keyof I18n = "command.line";

    constructor(start: XYZ, end: XYZ) {
        super();
        this._start = start;
        this._end = end;
    }

    body(): Result<IShape> {
        let edgeFactory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return edgeFactory!.line(this._start, this._end);
    }

    @property("curve.start")
    get start() {
        return this._start;
    }

    set start(pnt: XYZ) {
        if (this._start.isEqualTo(pnt, Precision.confusion)) return;
        this.setProperty("start", pnt);
    }

    @property("curve.end")
    get end() {
        return this._end;
    }

    set end(pnt: XYZ) {
        if (this._end.isEqualTo(pnt, Precision.confusion)) return;
        this.setProperty("end", pnt);
    }
}
