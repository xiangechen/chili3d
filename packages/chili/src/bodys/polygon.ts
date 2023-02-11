// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, I18n, IShape, Result, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { Body } from "./body";

export class PolygonBody extends Body {
    private _points: XYZ[];
    readonly name: keyof I18n = "body.polygon";

    constructor(...points: XYZ[]) {
        super();
        this._points = points;
    }

    protected generateShape(): Result<IShape, string> {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.polygon(...this._points);
    }
}
