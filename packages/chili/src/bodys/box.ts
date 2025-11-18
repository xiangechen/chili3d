// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    type Plane,
    Property,
    type Result,
    Serializer,
    type XYZ,
} from "chili-core";

@Serializer.register(["document", "plane", "dx", "dy", "dz"])
export class BoxNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.box";
    }

    @Serializer.serialze()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }

    @Property.define("common.location")
    get location() {
        return this.plane.origin;
    }
    set location(value: XYZ) {
        this.setPropertyEmitShapeChanged("plane", this.plane.translateTo(value));
    }

    @Serializer.serialze()
    @Property.define("box.dx")
    get dx() {
        return this.getPrivateValue("dx");
    }
    set dx(dx: number) {
        this.setPropertyEmitShapeChanged("dx", dx);
    }

    @Serializer.serialze()
    @Property.define("box.dy")
    get dy() {
        return this.getPrivateValue("dy");
    }
    set dy(dy: number) {
        this.setPropertyEmitShapeChanged("dy", dy);
    }

    @Serializer.serialze()
    @Property.define("box.dz")
    get dz() {
        return this.getPrivateValue("dz");
    }
    set dz(dz: number) {
        this.setPropertyEmitShapeChanged("dz", dz);
    }

    constructor(document: IDocument, plane: Plane, dx: number, dy: number, dz: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("dx", dx);
        this.setPrivateValue("dy", dy);
        this.setPrivateValue("dz", dz);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.box(this.plane, this.dx, this.dy, this.dz);
    }
}
