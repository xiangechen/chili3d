// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Body, I18nKeys, IDocument, IShape, Ray, Result, Serializer } from "chili-core";

@Serializer.register("RevolveBody", ["document", "profile", "axis", "angle"])
export class RevolveBody extends Body {
    override display: I18nKeys = "body.revol";

    private _profile: IShape;
    @Serializer.serialze()
    get profile() {
        return this._profile;
    }
    set profile(value: IShape) {
        this.setPropertyAndUpdate("profile", value);
    }

    private _axis: Ray;
    @Serializer.serialze()
    get axis() {
        return this._axis;
    }
    set axis(value: Ray) {
        this.setPropertyAndUpdate("axis", value);
    }

    private _angle: number;
    @Serializer.serialze()
    get angle() {
        return this._angle;
    }
    set angle(value: number) {
        this.setPropertyAndUpdate("angle", value);
    }

    constructor(document: IDocument, profile: IShape, axis: Ray, angle: number) {
        super(document);
        this._profile = profile;
        this._axis = axis;
        this._angle = angle;
    }

    protected override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.revolve(this.profile, this.axis, this.angle);
    }
}
