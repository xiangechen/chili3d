// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, I18n, IDocument, IShape, property, Result, XYZ } from "chili-core";
import { Application } from "../application";

export class CircleBody extends Entity {
    private _center: XYZ;
    private _radius: number;
    readonly name: keyof I18n = "body.circle";

    constructor(document: IDocument, readonly normal: XYZ, center: XYZ, radius: number) {
        super(document);
        this._center = center;
        this._radius = radius;
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.circle(this.normal, this._center, this._radius);
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
