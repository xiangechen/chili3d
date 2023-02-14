// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, I18n, IShape, Plane, property, Result } from "chili-core";
import { Application } from "../application";

export class BoxBody extends Entity {
    private _dx: number;
    private _dy: number;
    private _dz: number;
    readonly name: keyof I18n = "body.box";

    constructor(readonly plane: Plane, dx: number, dy: number, dz: number) {
        super();
        this._dx = dx;
        this._dy = dy;
        this._dz = dz;
    }

    protected generateShape(): Result<IShape> {
        return Application.instance.shapeFactory.box(this.plane, this._dx, this._dy, this._dz);
    }

    @property("box.dx")
    get dx() {
        return this._dx;
    }

    set dx(dx: number) {
        this.setPropertyAndUpdate("dx", dx);
    }

    @property("box.dy")
    get dy() {
        return this._dy;
    }

    set dy(dy: number) {
        this.setPropertyAndUpdate("dy", dy);
    }

    @property("box.dz")
    get dz() {
        return this._dz;
    }

    set dz(dz: number) {
        this.setPropertyAndUpdate("dz", dz);
    }
}
