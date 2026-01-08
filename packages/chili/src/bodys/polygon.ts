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

@serializable(["document", "points"])
export class PolygonNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.polygon";
    }

    @serialze()
    @property("polygon.points")
    get points() {
        return this.getPrivateValue("points");
    }
    set points(value: XYZ[]) {
        this.setPropertyEmitShapeChanged("points", value);
    }

    constructor(document: IDocument, points: XYZ[]) {
        super(document);
        this.setPrivateValue("points", points);
    }

    generateShape(): Result<IShape, string> {
        const wire = this.document.application.shapeFactory.polygon(this.points);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }
}
