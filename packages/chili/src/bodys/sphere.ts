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

@Serializer.register(["document", "center", "radius"])
export class SphereNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sphere";
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
