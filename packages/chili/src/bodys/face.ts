// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Body, I18nKeys, IDocument, IEdge, IShape, IWire, Result, Serializer } from "chili-core";

@Serializer.register("FaceBody", ["document", "shapes"])
export class FaceBody extends Body {
    override name: I18nKeys = "body.face";

    private _shapes: IEdge[] | IWire;
    @Serializer.serialze()
    get shapes(): IEdge[] | IWire {
        return this._shapes;
    }
    set shapes(values: IEdge[] | IWire) {
        this.setPropertyAndUpdate("shapes", values);
    }

    constructor(document: IDocument, shapes: IEdge[] | IWire) {
        super(document);
        this._shapes = Array.isArray(shapes) ? [...shapes] : shapes;
    }

    protected override generateShape(): Result<IShape> {
        if (Array.isArray(this._shapes)) {
            if (this._shapes.length === 0) {
                return Result.error("Cannot create face from empty array");
            }
            if (this._shapes.length === 1) {
                let wire = this.shapeFactory.wire(this._shapes[0]);
                if (!wire.success) return wire;
                return wire.value.toFace();
            } else {
                return this.shapeFactory.wire(...this._shapes);
            }
        } else {
            return this._shapes.toFace();
        }
    }
}
