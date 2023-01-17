// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, Token, I18n, Result, Plane } from "chili-shared";
import { IShapeFactory, IShape } from "chili-geo";
import { property } from "../decorators";
import { BodyBase } from "./base";

export class BoxBody extends BodyBase {
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

    protected generateBody(): Result<IShape> {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.box(this.plane, this._dx, this._dy, this._dz);
    }

    @property("box.dx")
    get dx() {
        return this._dx;
    }

    set dx(dx: number) {
        this.setPropertyAndUpdateBody("dx", dx);
    }

    @property("box.dy")
    get dy() {
        return this._dy;
    }

    set dy(dy: number) {
        this.setPropertyAndUpdateBody("dy", dy);
    }

    @property("box.dz")
    get dz() {
        return this._dz;
    }

    set dz(dz: number) {
        this.setPropertyAndUpdateBody("dz", dz);
    }
}
