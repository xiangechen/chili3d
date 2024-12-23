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

@Serializer.register(["document", "shapes"])
export class FaceNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.face";
    }

    @Serializer.serialze()
    get shapes(): IEdge[] | IWire[] {
        return this.getPrivateValue("shapes");
    }
    set shapes(values: IEdge[] | IWire[]) {
        this.setPropertyEmitShapeChanged("shapes", values);
    }

    constructor(document: IDocument, shapes: IEdge[] | IWire[]) {
        super(document);
        this.setPrivateValue("shapes", shapes);
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
                    let wire = this.document.application.shapeFactory.wire([shape as IEdge]);
                    wires.push(wire.value);
                }
            }
        } else {
            let wire = this.document.application.shapeFactory.wire((this.shapes as IEdge[]));
            if (!wire.isOk) throw new Error("Cannot create wire from open shapes");
            wires.push(wire.value);
        }

        for (let i = 1; i < wires.length; i++) {
            wires[i].reserve();
        }

        return wires;
    }

    override generateShape(): Result<IShape> {
        if (this.shapes.length === 0) return Result.err("No shapes to create face");

        let wires = this.getWires();
        return this.document.application.shapeFactory.face(wires);
    }
}
