// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Body, I18n, IDocument, IShape, Property, Result, Serializer, XYZ } from "chili-core";
import { Application } from "../application";

export class CircleBody extends Body {
    readonly name: keyof I18n = "body.circle";

    private _center: XYZ;

    @Serializer.property("constructor")
    @Property.define("circle.center")
    get center() {
        return this._center;
    }
    set center(center: XYZ) {
        this.setPropertyAndUpdate("center", center);
    }

    private _radius: number;

    @Serializer.property("constructor")
    @Property.define("circle.radius")
    get radius() {
        return this._radius;
    }
    set radius(radius: number) {
        this.setPropertyAndUpdate("radius", radius);
    }

    private _normal: XYZ;

    @Serializer.property("constructor")
    get normal() {
        return this._normal;
    }

    constructor(document: IDocument, normal: XYZ, center: XYZ, radius: number) {
        super(document);
        this._normal = normal;
        this._center = center;
        this._radius = radius;
    }

    @Serializer.deserializer()
    static from({
        document,
        normal,
        center,
        radius,
    }: {
        document: IDocument;
        normal: XYZ;
        center: XYZ;
        radius: number;
    }) {
        return new CircleBody(document, normal, center, radius);
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.circle(this.normal, this._center, this._radius);
    }
}
