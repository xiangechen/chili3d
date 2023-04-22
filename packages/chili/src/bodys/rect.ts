// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, I18n, IDocument, IShape, Plane, property, Result } from "chili-core";
import { Application } from "chili-core/src/application";

export class RectBody extends Entity {
    private _dx: number;
    private _dy: number;
    readonly name: keyof I18n = "body.rect";

    constructor(document: IDocument, readonly plane: Plane, dx: number, dy: number) {
        super(document);
        this._dx = dx;
        this._dy = dy;
    }

    protected generateShape(): Result<IShape, string> {
        return Application.instance.shapeFactory.rect(this.plane, this._dx, this._dy);
    }

    @property("rect.dx")
    get dx() {
        return this._dx;
    }

    set dx(dx: number) {
        this.setPropertyAndUpdate("dx", dx);
    }

    @property("rect.dy")
    get dy() {
        return this._dy;
    }

    set dy(dy: number) {
        this.setPropertyAndUpdate("dy", dy);
    }
}
