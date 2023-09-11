// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Body, ClassMap, I18nKeys, IDocument, ILine, IShape, Result, Serializer } from "chili-core";

@ClassMap.key("RevolveBody")
export class RevolveBody extends Body {
    override name: I18nKeys = "body.revol";

    private _profile: IShape;
    @Serializer.property("constructor")
    get profile() {
        return this._profile;
    }
    set profile(value: IShape) {
        this.setPropertyAndUpdate("profile", value);
    }

    private _axis: ILine;
    @Serializer.property("constructor")
    get axis() {
        return this._axis;
    }
    set axis(value: ILine) {
        this.setPropertyAndUpdate("axis", value);
    }

    private _angle: number;
    @Serializer.property("constructor")
    get angle() {
        return this._angle;
    }
    set angle(value: number) {
        this.setPropertyAndUpdate("angle", value);
    }

    constructor(document: IDocument, profile: IShape, axis: ILine, angle: number) {
        super(document);
        this._profile = profile;
        this._axis = axis;
        this._angle = angle;
    }

    @Serializer.deserializer()
    static from({
        document,
        profile,
        axis,
        angle,
    }: {
        document: IDocument;
        profile: IShape;
        axis: ILine;
        angle: number;
    }) {
        return new RevolveBody(document, profile, axis, angle);
    }

    protected override generateShape(): Result<IShape> {
        return this.shapeFactory.revolve(this.profile, this.axis, this.angle);
    }
}
