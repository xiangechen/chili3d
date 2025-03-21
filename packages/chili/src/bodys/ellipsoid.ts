// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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

@Serializer.register(["document", "normal", "center", "xVec", "radiusX", "radiusY", "radiusZ"])
export class EllipsoidNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.ellipsoid";
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
    @Property.define("ellipsoid.radiusX")
    get radiusX() {
        return this.getPrivateValue("radiusX");
    }
    set radiusX(radius: number) {
        this.setPropertyEmitShapeChanged("radiusX", radius);
    }
    @Serializer.serialze()
    @Property.define("ellipsoid.radiusY")
    get radiusY() {
        return this.getPrivateValue("radiusY");
    }
    set radiusY(radius: number) {
        this.setPropertyEmitShapeChanged("radiusY", radius);
    }
    @Serializer.serialze()
    @Property.define("ellipsoid.radiusZ")
    get radiusZ() {
        return this.getPrivateValue("radiusZ");
    }
    set radiusZ(radius: number) {
        this.setPropertyEmitShapeChanged("radiusZ", radius);
    }

    @Serializer.serialze()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }
    @Serializer.serialze()
    get xVec(): XYZ {
        return this.getPrivateValue("xVec");
    }

    constructor(
        document: IDocument,
        normal: XYZ,
        center: XYZ,
        xVec: XYZ,
        radiusX: number,
        radiusY: number,
        radiusZ: number,
    ) {
        super(document);
        this.setPrivateValue("normal", normal);
        this.setPrivateValue("xVec", xVec);
        this.setPrivateValue("center", center);
        this.setPrivateValue("radiusX", radiusX);
        this.setPrivateValue("radiusY", radiusY);
        this.setPrivateValue("radiusZ", radiusZ);
    }

    generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.ellipsoid(
            this.normal,
            this.center,
            this.xVec,
            this.radiusX,
            this.radiusY,
            this.radiusZ,
        );
    }
}
