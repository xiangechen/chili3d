// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    property,
    type Result,
    serializable,
    serialze,
    type XYZ,
} from "chili-core";

@serializable(["document", "normal", "center", "start", "angle"])
export class ArcNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.arc";
    }

    @serialze()
    @property("circle.center")
    get center() {
        return this.getPrivateValue("center");
    }
    set center(center: XYZ) {
        this.setPropertyEmitShapeChanged("center", center);
    }

    @serialze()
    @property("arc.start")
    get start(): XYZ {
        return this.getPrivateValue("start");
    }

    @serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    @serialze()
    @property("arc.angle")
    get angle() {
        return this.getPrivateValue("angle");
    }
    set angle(value: number) {
        this.setPropertyEmitShapeChanged("angle", value);
    }

    constructor(document: IDocument, normal: XYZ, center: XYZ, start: XYZ, angle: number) {
        super(document);
        this.setPrivateValue("normal", normal);
        this.setPrivateValue("center", center);
        this.setPrivateValue("start", start);
        this.setPrivateValue("angle", angle);
    }

    generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.arc(this.normal, this.center, this.start, this.angle);
    }
}
