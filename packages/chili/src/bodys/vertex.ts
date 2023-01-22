// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShapeFactory } from "chili-geo";
import { Container, i18n, Token, Precision, XYZ, I18n, Result } from "chili-shared";
import { IShape } from "chili-core/src/shape";
import { BodyBase } from "./base";

export class VertexBody extends BodyBase {
    private _pnt: XYZ;
    readonly name: keyof I18n = "command.line";

    constructor(pnt: XYZ) {
        super();
        this._pnt = pnt;
    }

    protected generateBody(): Result<IShape, string> {
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
