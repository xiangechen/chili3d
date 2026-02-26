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

@serializable(["document", "position"])
export class PointNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.point";
    }

    @serialze()
    @property("point.position")
    get position() {
        return this.getPrivateValue("position");
    }
    set position(pnt: XYZ) {
        this.setPropertyEmitShapeChanged("position", pnt);
    }

    constructor(document: IDocument, position: XYZ) {
        super(document);
        this.setPrivateValue("position", position);
    }

    generateShape(): Result<IShape, string> {
        return this.document.application.shapeFactory.point(this.position);
    }
}
