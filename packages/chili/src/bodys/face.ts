// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    I18nKeys,
    IDocument,
    IEdge,
    IShape,
    IWire,
    ParameterBody,
    Result,
    Serializer,
    ShapeType,
} from "chili-core";

@Serializer.register(["document", "shapes"])
export class FaceBody extends ParameterBody {
    override display: I18nKeys = "body.face";

    private _shapes: IEdge[] | IWire[];
    @Serializer.serialze()
    get shapes(): IEdge[] | IWire[] {
        return this._shapes;
    }
    set shapes(values: IEdge[] | IWire) {
        this.setProperty("shapes", values);
    }

    constructor(document: IDocument, shapes: IEdge[] | IWire[]) {
        super(document);
        this._shapes = shapes;
    }

    private isAllClosed(): boolean {
        return this.shapes.every((shape) => shape.isClosed() || shape.shapeType === ShapeType.Wire);
    }

    private getWires(): IWire[] {
        let wires: IWire[] = [];
        if (this.isAllClosed()) {
            for (const shape of this.shapes) {
                if (shape.shapeType === ShapeType.Wire) {
                    wires.push(shape as IWire);
                } else {
                    let wire = this.document.application.shapeFactory.wire(shape as IEdge);
                    wires.push(wire.ok());
                }
            }
        } else {
            let wire = this.document.application.shapeFactory.wire(...(this._shapes as IEdge[]));
            if (!wire.isOk) throw new Error("Cannot create wire from open shapes");
            wires.push(wire.ok());
        }

        for (let i = 1; i < wires.length; i++) {
            wires[i].reserve();
        }

        return wires;
    }

    override generateShape(): Result<IShape> {
        if (this.shapes.length === 0) return Result.err("No shapes to create face");

        let wires = this.getWires();
        return this.document.application.shapeFactory.face(...wires);
    }
}
