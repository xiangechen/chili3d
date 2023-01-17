// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, Token, I18n, Result, Plane } from "chili-shared";
import { IShapeFactory, IShape } from "chili-geo";
import { property } from "../decorators";
import { BodyBase } from "./base";

export class RectBody extends BodyBase {
    private _dx: number;
    private _dy: number;
    readonly name: keyof I18n = "body.rect";

    constructor(readonly plane: Plane, dx: number, dy: number) {
        super();
        this._dx = dx;
        this._dy = dy;
    }

    protected generateBody(): Result<IShape, string> {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.rect(this.plane, this._dx, this._dy);
    }

    @property("rect.dx")
    get dx() {
        return this._dx;
    }

    set dx(dx: number) {
        this.setPropertyAndUpdateBody("dx", dx);
    }

    @property("rect.dy")
    get dy() {
        return this._dy;
    }

    set dy(dy: number) {
        this.setPropertyAndUpdateBody("dy", dy);
    }
}
