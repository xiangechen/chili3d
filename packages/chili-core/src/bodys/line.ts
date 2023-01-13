// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, i18n, Token, Precision, XYZ, XYZConverter, I18n } from "chili-shared";
import { IBody, IEdge, IEdgeFactory, IShape } from "chili-geo";
import { property } from "../decorators";

export class LineBody implements IBody {
    private _start: XYZ;
    private _end: XYZ;
    readonly name: keyof I18n = "command.line";

    constructor(start: XYZ, end: XYZ) {
        this._start = start;
        this._end = end;
    }

    body(): IShape | undefined {
        let edgeFactory = Container.default.resolve<IEdgeFactory>(Token.EdgeFactory);
        let edge = edgeFactory?.byStartAndEnd(this._start, this._end);
        return edge?.ok();
    }

    @property("curve.start", new XYZConverter())
    get start() {
        return this._start;
    }

    set start(pnt: XYZ) {
        if (this._start.isEqualTo(pnt, Precision.confusion)) return;
        this._start = pnt;
        // this.update()
    }

    @property("curve.end")
    get end() {
        return this._end;
    }

    set end(pnt: XYZ) {
        if (this._end.isEqualTo(pnt, Precision.confusion)) return;
        this._end = pnt;
        // this.update()
    }
}
