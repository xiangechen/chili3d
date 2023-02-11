// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, I18n, IShape, property, Result, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { XYZEqualityComparer } from "../comparers";

import { Body } from "./body";

export class CircleBody extends Body {
    private _center: XYZ;
    private _radius: number;
    readonly name: keyof I18n = "body.circle";

    constructor(readonly normal: XYZ, center: XYZ, radius: number) {
        super();
        this._center = center;
        this._radius = radius;
    }

    protected generateShape(): Result<IShape, string> {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.circle(this.normal, this._center, this._radius);
    }

    @property("circle.center")
    get center() {
        return this._center;
    }

    set center(center: XYZ) {
        this.setPropertyAndUpdate("center", center);
    }

    @property("circle.radius")
    get radius() {
        return this._radius;
    }

    set radius(radius: number) {
        this.setPropertyAndUpdate("radius", radius);
    }
}
