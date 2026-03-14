// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    type Line,
    ParameterShapeNode,
    type Result,
    serializable,
    serialize,
} from "@chili3d/core";

export interface RevolveOptions {
    document: IDocument;
    profile: IShape;
    axis: Line;
    angle: number;
}

@serializable()
export class RevolvedNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.revol";
    }

    @serialize()
    get profile() {
        return this.getPrivateValue("profile");
    }
    set profile(value: IShape) {
        this.setPropertyEmitShapeChanged("profile", value);
    }

    @serialize()
    get axis() {
        return this.getPrivateValue("axis");
    }
    set axis(value: Line) {
        this.setPropertyEmitShapeChanged("axis", value);
    }

    @serialize()
    get angle() {
        return this.getPrivateValue("angle");
    }
    set angle(value: number) {
        this.setPropertyEmitShapeChanged("angle", value);
    }

    constructor(options: RevolveOptions) {
        super({ document: options.document });
        this.setPrivateValue("profile", options.profile);
        this.setPrivateValue("axis", options.axis);
        this.setPrivateValue("angle", options.angle);
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.revolve(this.profile, this.axis, this.angle);
    }
}
