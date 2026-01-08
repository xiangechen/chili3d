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
    serialze,
} from "chili-core";

@serializable(["document", "profile", "axis", "angle"])
export class RevolvedNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.revol";
    }

    @serialze()
    get profile() {
        return this.getPrivateValue("profile");
    }
    set profile(value: IShape) {
        this.setPropertyEmitShapeChanged("profile", value);
    }

    @serialze()
    get axis() {
        return this.getPrivateValue("axis");
    }
    set axis(value: Line) {
        this.setPropertyEmitShapeChanged("axis", value);
    }

    @serialze()
    get angle() {
        return this.getPrivateValue("angle");
    }
    set angle(value: number) {
        this.setPropertyEmitShapeChanged("angle", value);
    }

    constructor(document: IDocument, profile: IShape, axis: Line, angle: number) {
        super(document);
        this.setPrivateValue("profile", profile);
        this.setPrivateValue("axis", axis);
        this.setPrivateValue("angle", angle);
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.revolve(this.profile, this.axis, this.angle);
    }
}
