// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Body, I18n, IDocument, IShape, Matrix4, Plane, property, Result } from "chili-core";
import { Application } from "chili-core/src/application";

export class BoxBody extends Body {
    readonly name: keyof I18n = "body.box";
    private readonly initialPlane: Plane;

    private _dx: number;
    @property("box.dx")
    get dx() {
        return this._dx;
    }
    set dx(dx: number) {
        this.setPropertyAndUpdate("dx", dx);
    }

    private _dy: number;
    @property("box.dy")
    get dy() {
        return this._dy;
    }
    set dy(dy: number) {
        this.setPropertyAndUpdate("dy", dy);
    }

    private _dz: number;
    @property("box.dz")
    get dz() {
        return this._dz;
    }
    set dz(dz: number) {
        this.setPropertyAndUpdate("dz", dz);
    }

    private _plane: Plane;
    get plane() {
        return this._plane;
    }

    constructor(document: IDocument, plane: Plane, dx: number, dy: number, dz: number) {
        super(document);
        this.initialPlane = plane;
        this._plane = plane;
        this._dx = dx;
        this._dy = dy;
        this._dz = dz;
    }

    protected generateShape(): Result<IShape> {
        return Application.instance.shapeFactory.box(this.plane, this._dx, this._dy, this._dz);
    }

    override setMatrix(matrix: Matrix4): void {
        this._plane = this.initialPlane.transformed(matrix);
    }
}
