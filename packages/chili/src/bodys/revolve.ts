// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, IShape, ParameterBody, Ray, Result, Serializer } from "chili-core";

@Serializer.register("RevolveBody", ["document", "profile", "axis", "angle"])
export class RevolveBody extends ParameterBody {
    override display: I18nKeys = "body.revol";

    private _profile: IShape;
    @Serializer.serialze()
    get profile() {
        return this._profile;
    }
    set profile(value: IShape) {
        this.setProperty("profile", value);
    }

    private _axis: Ray;
    @Serializer.serialze()
    get axis() {
        return this._axis;
    }
    set axis(value: Ray) {
        this.setProperty("axis", value);
    }

    private _angle: number;
    @Serializer.serialze()
    get angle() {
        return this._angle;
    }
    set angle(value: number) {
        this.setProperty("angle", value);
    }

    constructor(document: IDocument, profile: IShape, axis: Ray, angle: number) {
        super(document);
        this._profile = profile;
        this._axis = axis;
        this._angle = angle;
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.revolve(this.profile, this.axis, this.angle);
    }
}
