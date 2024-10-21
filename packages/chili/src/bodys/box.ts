// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    I18nKeys,
    IDocument,
    IShape,
    ParameterShapeNode,
    Plane,
    Property,
    Result,
    Serializer,
} from "chili-core";

@Serializer.register(["document", "plane", "dx", "dy", "dz"])
export class BoxNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.box";
    }

    private _dx: number;

    @Serializer.serialze()
    @Property.define("box.dx")
    get dx() {
        return this._dx;
    }
    set dx(dx: number) {
        this.setProperty("dx", dx);
    }

    private _dy: number;

    @Serializer.serialze()
    @Property.define("box.dy")
    get dy() {
        return this._dy;
    }
    set dy(dy: number) {
        this.setProperty("dy", dy);
    }

    private _dz: number;

    @Serializer.serialze()
    @Property.define("box.dz")
    get dz() {
        return this._dz;
    }
    set dz(dz: number) {
        this.setProperty("dz", dz);
    }

    private _plane: Plane;

    @Serializer.serialze()
    get plane() {
        return this._plane;
    }

    constructor(document: IDocument, plane: Plane, dx: number, dy: number, dz: number) {
        super(document);
        this._plane = plane;
        this._dx = dx;
        this._dy = dy;
        this._dz = dz;
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.box(this.plane, this._dx, this._dy, this._dz);
    }
}
