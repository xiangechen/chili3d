// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Body, I18nKeys, IDocument, IShape, Plane, Property, Result, Serializer } from "chili-core";

export class BoxBody extends Body {
    readonly name: I18nKeys = "body.box";

    private _dx: number;

    @Serializer.property("constructor")
    @Property.define("box.dx")
    get dx() {
        return this._dx;
    }
    set dx(dx: number) {
        this.setPropertyAndUpdate("dx", dx);
    }

    private _dy: number;

    @Serializer.property("constructor")
    @Property.define("box.dy")
    get dy() {
        return this._dy;
    }
    set dy(dy: number) {
        this.setPropertyAndUpdate("dy", dy);
    }

    private _dz: number;

    @Serializer.property("constructor")
    @Property.define("box.dz")
    get dz() {
        return this._dz;
    }
    set dz(dz: number) {
        this.setPropertyAndUpdate("dz", dz);
    }

    private _plane: Plane;

    @Serializer.property("constructor")
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

    @Serializer.deserializer()
    static from({
        document,
        plane,
        dx,
        dy,
        dz,
    }: {
        document: IDocument;
        plane: Plane;
        dx: number;
        dy: number;
        dz: number;
    }) {
        return new BoxBody(document, plane, dx, dy, dz);
    }

    protected generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.box(this.plane, this._dx, this._dy, this._dz);
    }
}
