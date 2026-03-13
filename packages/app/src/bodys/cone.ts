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
} from "@chili3d/core";

export interface ConeNodeOptions {
    document: IDocument;
    normal: XYZ;
    center: XYZ;
    radius: number;
    dz: number;
}

@serializable(["document", "normal", "center", "radius", "dz"])
export class ConeNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.cone";
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
    set radius(dy: number) {
        this.setPropertyEmitShapeChanged("radius", dy);
    }

    @serialze()
    @property("box.dz")
    get dz() {
        return this.getPrivateValue("dz");
    }
    set dz(dz: number) {
        this.setPropertyEmitShapeChanged("dz", dz);
    }

    @serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    constructor(options: ConeNodeOptions) {
        super(options);
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("center", options.center);
        this.setPrivateValue("radius", options.radius);
        this.setPrivateValue("dz", options.dz);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.cone(this.normal, this.center, this.radius, 0, this.dz);
    }
}
