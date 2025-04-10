// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import {
    I18nKeys,
    IDocument,
    IShape,
    ParameterShapeNode,
    Property,
    Result,
    Serializer,
    XYZ,
} from "chili-core";

@Serializer.register(["document", "normal", "center", "radius", "dz"])
export class CylinderNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.cylinder";
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
    @Property.define("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(dy: number) {
        this.setPropertyEmitShapeChanged("radius", dy);
    }

    @Serializer.serialze()
    @Property.define("box.dz")
    get dz() {
        return this.getPrivateValue("dz");
    }
    set dz(dz: number) {
        this.setPropertyEmitShapeChanged("dz", dz);
    }

    @Serializer.serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    constructor(document: IDocument, normal: XYZ, center: XYZ, radius: number, dz: number) {
        super(document);
        this.setPrivateValue("normal", normal);
        this.setPrivateValue("center", center);
        this.setPrivateValue("radius", radius);
        this.setPrivateValue("dz", dz);
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
