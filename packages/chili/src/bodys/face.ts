// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
            this.addClosedEdges(wires, this.shapes as IEdge[]);
        } else {
            this.addUnclosedEdges(wires, this.shapes as IEdge[]);
        }

        for (let i = 1; i < wires.length; i++) {
            wires[i].reserve();
        }

        return wires;
    }

    private addClosedEdges(wires: IWire[], edges: IEdge[]): void {
        for (const shape of this.shapes) {
            if (shape.shapeType === ShapeType.Wire) {
                wires.push(shape as IWire);
            } else {
                this.addUnclosedEdges(wires, [shape as IEdge]);
            }
        }
    }

    private addUnclosedEdges(wires: IWire[], edges: IEdge[]): void {
        let wire = this.document.application.shapeFactory.wire(edges);
        if (!wire.isOk) throw new Error("Cannot create wire from open shapes");
        wires.push(wire.value);
    }

    override generateShape(): Result<IShape> {
        if (this.shapes.length === 0) return Result.err("No shapes to create face");

        let wires = this.getWires();
        return this.document.application.shapeFactory.face(wires);
    }
}
