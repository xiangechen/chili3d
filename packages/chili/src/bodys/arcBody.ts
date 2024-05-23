// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, IShape, ParameterBody, Property, Result, Serializer, XYZ } from "chili-core";

@Serializer.register("ArcBody", ["document", "normal", "center", "start", "angle"])
export class ArcBody extends ParameterBody {
    readonly display: I18nKeys = "body.arc";

    private _center: XYZ;

    @Serializer.serialze()
    @Property.define("circle.center")
    get center() {
        return this._center;
    }
    set center(center: XYZ) {
        this.setProperty("center", center);
    }

    private _start: XYZ;
    @Serializer.serialze()
    @Property.define("arc.start")
    get start() {
        return this._start;
    }

    private _normal: XYZ;

    @Serializer.serialze()
    get normal() {
        return this._normal;
    }

    private _angle: number;
    @Serializer.serialze()
    @Property.define("arc.angle")
    get angle() {
        return this._angle;
    }
    set angle(value: number) {
        this.setProperty("angle", value);
    }

    constructor(document: IDocument, normal: XYZ, center: XYZ, start: XYZ, angle: number) {
        super(document);
        this._normal = normal;
        this._center = center;
        this._start = start;
        this._angle = angle;
    }

    generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.arc(
            this.normal,
            this._center,
            this._start,
            this.angle,
        );
    }
}
