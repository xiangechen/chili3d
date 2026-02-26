// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FacebaseNode,
    type I18nKeys,
    type IDocument,
    type IShape,
    property,
    type Result,
    serializable,
    serialze,
    type XYZ,
} from "chili-core";

@serializable(["document", "normal", "center", "radius"])
export class CircleNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.circle";
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
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(radius: number) {
        this.setPropertyEmitShapeChanged("radius", radius);
    }

    @serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    constructor(document: IDocument, normal: XYZ, center: XYZ, radius: number) {
        super(document);
        this.setPrivateValue("normal", normal);
        this.setPrivateValue("center", center);
        this.setPrivateValue("radius", radius);
    }

    generateShape(): Result<IShape, string> {
        const circle = this.document.application.shapeFactory.circle(this.normal, this.center, this.radius);
        if (!circle.isOk || !this.isFace) return circle;
        const wire = this.document.application.shapeFactory.wire([circle.value]);
        return wire.isOk ? wire.value.toFace() : circle;
    }
}
