// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FacebaseNode, I18nKeys, IDocument, IShape, Property, Result, Serializer, XYZ } from "chili-core";

@Serializer.register(["document", "normal", "center", "xvec", "majorRadius", "minorRadius"])
export class EllipseNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.ellipse";
    }

    @Serializer.serialze()
    @Property.define("circle.center")
    get center() {
        return this.getPrivateValue("center");
    }
    set center(center: XYZ) {
        this.setPropertyEmitShapeChanged("center", center);
    }

    @Serializer.serialze()
    @Property.define("ellipse.majorRadius")
    get majorRadius() {
        return this.getPrivateValue("majorRadius");
    }
    set majorRadius(radius: number) {
        this.setPropertyEmitShapeChanged("majorRadius", radius);
    }
    @Serializer.serialze()
    @Property.define("ellipse.minorRadius")
    get minorRadius() {
        return this.getPrivateValue("minorRadius");
    }
    set minorRadius(radius: number) {
        this.setPropertyEmitShapeChanged("minorRadius", radius);
    }

    @Serializer.serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    @Serializer.serialze()
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
        let circle = this.document.application.shapeFactory.ellipse(
            this.normal,
            this.center,
            this.xvec,
            this.majorRadius,
            this.minorRadius,
        );
        if (!circle.isOk || !this.isFace) return circle;
        let wire = this.document.application.shapeFactory.wire([circle.value]);
        return wire.isOk ? wire.value.toFace() : circle;
    }
}
