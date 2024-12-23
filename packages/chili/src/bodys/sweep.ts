// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    I18nKeys,
    IDocument,
    IEdge,
    IShape,
    IWire,
    ParameterShapeNode,
    Result,
    Serializer,
    ShapeType,
} from "chili-core";

@Serializer.register(["document", "profile", "path"])
export class SweepedNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sweep";
    }

    @Serializer.serialze()
    get profile() {
        return this.getPrivateValue("profile");
    }
    set profile(value: IShape) {
        this.setPropertyEmitShapeChanged("profile", value);
    }

    @Serializer.serialze()
    get path() {
        return this.getPrivateValue("path");
    }
    set path(value: IWire) {
        this.setPropertyEmitShapeChanged("path", value);
    }

    constructor(document: IDocument, profile: IShape, path: IWire | IEdge) {
        super(document);
        this.setPrivateValue("profile", profile);

        let wire = path as IWire;
        if (path.shapeType !== ShapeType.Wire) {
            wire = document.application.shapeFactory.wire([path as unknown as IEdge]).value;
        }
        this.setPrivateValue("path", wire);
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.sweep(this.profile, this.path);
    }
}
