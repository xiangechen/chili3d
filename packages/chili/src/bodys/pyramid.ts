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
} from "chili-core";

@serializable(["document", "plane", "dx", "dy", "dz"])
export class PyramidNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.pyramid";
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

    @serialze()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }

    constructor(document: IDocument, plane: Plane, dx: number, dy: number, dz: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("dx", dx);
        this.setPrivateValue("dy", dy);
        this.setPrivateValue("dz", dz);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.pyramid(this.plane, this.dx, this.dy, this.dz);
    }
}
