// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody, IShape, IVertex, IVertexFactory } from "chili-geo";
import { Container, i18n, Token, Precision, XYZ, XYZConverter, I18n } from "chili-shared";
import { property } from "chili-core";

export class VertexBody implements IBody {
    private _pnt: XYZ;
    readonly name: keyof I18n = "command.line";

    constructor(pnt: XYZ) {
        this._pnt = pnt;
    }

    body(): IShape | undefined {
        let vertexFactory = Container.default.resolve<IVertexFactory>(Token.VertexFactory);
        return vertexFactory?.byXYZ(this._pnt).ok();
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
