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

@serializable(["document", "normal", "center", "xvec", "majorRadius", "minorRadius"])
export class EllipseNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.ellipse";
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
    @property("ellipse.majorRadius")
    get majorRadius() {
        return this.getPrivateValue("majorRadius");
    }
    set majorRadius(radius: number) {
        this.setPropertyEmitShapeChanged("majorRadius", radius);
    }
    @serialze()
    @property("ellipse.minorRadius")
    get minorRadius() {
        return this.getPrivateValue("minorRadius");
    }
    set minorRadius(radius: number) {
        this.setPropertyEmitShapeChanged("minorRadius", radius);
    }

    @serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    @serialze()
    get xvec(): XYZ {
        return this.getPrivateValue("xvec");
    }

    constructor(
        document: IDocument,
        normal: XYZ,
        center: XYZ,
        xvec: XYZ,
        majorRadius: number,
        minorRadius: number,
    ) {
        super(document);
        this.setPrivateValue("normal", normal);
        this.setPrivateValue("center", center);
        this.setPrivateValue("xvec", xvec);
        this.setPrivateValue("majorRadius", majorRadius);
        this.setPrivateValue("minorRadius", minorRadius);
    }

    generateShape(): Result<IShape, string> {
        const circle = this.document.application.shapeFactory.ellipse(
            this.normal,
            this.center,
            this.xvec,
            this.majorRadius,
            this.minorRadius,
        );
        if (!circle.isOk || !this.isFace) return circle;
        const wire = this.document.application.shapeFactory.wire([circle.value]);
        return wire.isOk ? wire.value.toFace() : circle;
    }
}
