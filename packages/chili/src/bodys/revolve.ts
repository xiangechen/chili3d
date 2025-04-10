// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { I18nKeys, IDocument, IShape, ParameterShapeNode, Ray, Result, Serializer } from "chili-core";

@Serializer.register(["document", "profile", "axis", "angle"])
export class RevolvedNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.revol";
    }

    @Serializer.serialze()
    get profile() {
        return this.getPrivateValue("profile");
    }
    set profile(value: IShape) {
        this.setPropertyEmitShapeChanged("profile", value);
    }

    @Serializer.serialze()
    get axis() {
        return this.getPrivateValue("axis");
    }
    set axis(value: Ray) {
        this.setPropertyEmitShapeChanged("axis", value);
    }

    @Serializer.serialze()
    get angle() {
        return this.getPrivateValue("angle");
    }
    set angle(value: number) {
        this.setPropertyEmitShapeChanged("angle", value);
    }

    constructor(document: IDocument, profile: IShape, axis: Ray, angle: number) {
        super(document);
        this.setPrivateValue("profile", profile);
        this.setPrivateValue("axis", axis);
        this.setPrivateValue("angle", angle);
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.revolve(this.profile, this.axis, this.angle);
    }
}
