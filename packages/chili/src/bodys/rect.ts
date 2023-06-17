// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Application,
    Body,
    I18n,
    IDocument,
    IShape,
    Matrix4,
    Plane,
    property,
    Result,
    Serialize,
} from "chili-core";

export class RectBody extends Body {
    readonly name: keyof I18n = "body.rect";

    private readonly initialPlane: Plane;

    private _dx: number;
    @Serialize.property()
    @property("rect.dx")
    get dx() {
        return this._dx;
    }
    set dx(dx: number) {
        this.setPropertyAndUpdate("dx", dx);
    }

    private _dy: number;
    @Serialize.property()
    @property("rect.dy")
    get dy() {
        return this._dy;
    }
    set dy(dy: number) {
        this.setPropertyAndUpdate("dy", dy);
    }

    private _plane: Plane;
    @Serialize.property()
    get plane() {
        return this._plane;
    }

    constructor(document: IDocument, plane: Plane, dx: number, dy: number) {
        super(document);
        this.initialPlane = plane;
        this._plane = plane;
        this._dx = dx;
        this._dy = dy;
    }

    @Serialize.deserializer()
    static from({ document, plane, dx, dy }: { document: IDocument; plane: Plane; dx: number; dy: number }) {
        return new RectBody(document, plane, dx, dy);
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.rect(this.plane, this._dx, this._dy);
    }

    override setMatrix(matrix: Matrix4): void {
        this._plane = this.initialPlane.transformed(matrix);
    }
}
