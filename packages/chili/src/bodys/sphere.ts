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

@serializable(["document", "center", "radius"])
export class SphereNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sphere";
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
    set radius(value: number) {
        this.setPropertyEmitShapeChanged("radius", value);
    }

    constructor(document: IDocument, center: XYZ, radius: number) {
        super(document);
        this.setPrivateValue("center", center);
        this.setPrivateValue("radius", radius);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.sphere(this.center, this.radius);
    }
}
