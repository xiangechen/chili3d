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
    serialze,
    type XYZ,
} from "@chili3d/core";

export interface BoxNodeOptions {
    document: IDocument;
    plane: Plane;
    dx: number;
    dy: number;
    dz: number;
}

@serializable(["document", "plane", "dx", "dy", "dz"])
export class BoxNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.box";
    }

    @serialze()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }

    @property("common.location")
    get location() {
        return this.plane.origin;
    }
    set location(value: XYZ) {
        this.setPropertyEmitShapeChanged("plane", this.plane.translateTo(value));
    }

    @serialze()
    @property("box.dx")
    get dx() {
        return this.getPrivateValue("dx");
    }
    set dx(dx: number) {
        this.setPropertyEmitShapeChanged("dx", dx);
    }

    @serialze()
    @property("box.dy")
    get dy() {
        return this.getPrivateValue("dy");
    }
    set dy(dy: number) {
        this.setPropertyEmitShapeChanged("dy", dy);
    }

    @serialze()
    @property("box.dz")
    get dz() {
        return this.getPrivateValue("dz");
    }
    set dz(dz: number) {
        this.setPropertyEmitShapeChanged("dz", dz);
    }

    constructor(options: BoxNodeOptions) {
        super(options);
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue("dx", options.dx);
        this.setPrivateValue("dy", options.dy);
        this.setPrivateValue("dz", options.dz);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.box(this.plane, this.dx, this.dy, this.dz);
    }
}
