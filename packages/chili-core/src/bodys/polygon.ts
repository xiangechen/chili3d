// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, Token, I18n, Result, XYZ } from "chili-shared";
import { IShapeFactory, IShape } from "chili-geo";
import { BodyBase } from "./base";

export class PolygonBody extends BodyBase {
    private _points: XYZ[];
    readonly name: keyof I18n = "body.polygon";

    constructor(...points: XYZ[]) {
        super();
        this._points = points;
    }

    protected generateBody(): Result<IShape, string> {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.polygon(...this._points);
    }
}
