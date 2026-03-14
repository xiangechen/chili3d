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
    serialize,
    type XYZ,
} from "@chili3d/core";

export interface CylinderNodeOptions {
    document: IDocument;
    normal: XYZ;
    center: XYZ;
    radius: number;
    dz: number;
}

@serializable()
export class CylinderNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.cylinder";
    }

    @serialize()
    @property("circle.center")
    get center() {
        return this.getPrivateValue("center");
    }
    set center(center: XYZ) {
        this.setPropertyEmitShapeChanged("center", center);
    }

    @serialize()
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(dy: number) {
        this.setPropertyEmitShapeChanged("radius", dy);
    }

    @serialize()
    @property("box.dz")
    get dz() {
        return this.getPrivateValue("dz");
    }
    set dz(dz: number) {
        this.setPropertyEmitShapeChanged("dz", dz);
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    constructor(options: CylinderNodeOptions) {
        super(options);
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("center", options.center);
        this.setPrivateValue("radius", options.radius);
        this.setPrivateValue("dz", options.dz);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.cylinder(
            this.normal,
            this.center,
            this.radius,
            this.dz,
        );
    }
}
