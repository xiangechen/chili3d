// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    type Plane,
    property,
    type Result,
    serializable,
    serialize,
} from "@chili3d/core";

export interface PyramidNodeOptions {
    document: IDocument;
    plane: Plane;
    dx: number;
    dy: number;
    dz: number;
}

@serializable()
export class PyramidNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.pyramid";
    }

    @serialize()
    @property("box.dx")
    get dx() {
        return this.getPrivateValue("dx");
    }
    set dx(dx: number) {
        this.setPropertyEmitShapeChanged("dx", dx);
    }

    @serialize()
    @property("box.dy")
    get dy() {
        return this.getPrivateValue("dy");
    }
    set dy(dy: number) {
        this.setPropertyEmitShapeChanged("dy", dy);
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
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }

    constructor(options: PyramidNodeOptions) {
        super(options);
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue("dx", options.dx);
        this.setPrivateValue("dy", options.dy);
        this.setPrivateValue("dz", options.dz);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.pyramid(this.plane, this.dx, this.dy, this.dz);
    }
}
