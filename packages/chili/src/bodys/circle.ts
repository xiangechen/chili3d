// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Application,
    Body,
    I18n,
    IDocument,
    IShape,
    Matrix4,
    property,
    Result,
    Serialize,
    XYZ,
} from "chili-core";

export class CircleBody extends Body {
    readonly name: keyof I18n = "body.circle";
    private readonly initialCenter: XYZ;
    private readonly initialNormal: XYZ;

    private _center: XYZ;

    @Serialize.property()
    @property("circle.center")
    get center() {
        return this._center;
    }
    set center(center: XYZ) {
        this.setPropertyAndUpdate("center", center);
    }

    private _radius: number;

    @Serialize.property()
    @property("circle.radius")
    get radius() {
        return this._radius;
    }
    set radius(radius: number) {
        this.setPropertyAndUpdate("radius", radius);
    }

    private _normal: XYZ;

    @Serialize.property()
    get normal() {
        return this._normal;
    }

    constructor(document: IDocument, normal: XYZ, center: XYZ, radius: number) {
        super(document);
        this.initialCenter = center;
        this.initialNormal = normal;
        this._normal = normal;
        this._center = center;
        this._radius = radius;
    }

    @Serialize.deserializer()
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

    override setMatrix(matrix: Matrix4): void {
        this._center = matrix.ofPoint(this.initialCenter);
        this._normal = matrix.ofVector(this.initialNormal);
    }
}
