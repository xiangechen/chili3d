// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, Container, I18n, IShape, Precision, Result, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

export class VertexBody extends Entity {
    private _pnt: XYZ;
    readonly name: keyof I18n = "command.line";

    constructor(pnt: XYZ) {
        super();
        this._pnt = pnt;
    }

    protected generateShape(): Result<IShape, string> {
        let vertexFactory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return vertexFactory!.point(this._pnt);
    }

    // @parameter("坐标", i18n.vertexBodyPoint, new XYZConverter())
    get point() {
        return this._pnt;
    }

    set point(pnt: XYZ) {
        if (this._pnt.isEqualTo(pnt, Precision.confusion)) return;
        this._pnt = pnt;
        // this.update()
    }
}
