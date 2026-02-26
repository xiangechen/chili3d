// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    ParameterShapeNode,
    Result,
    ShapeType,
    serializable,
    serialze,
} from "chili-core";

@serializable(["document", "shapes"])
export class FaceNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.face";
    }

    @serialze()
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
        const wires: IWire[] = [];
        if (this.isAllClosed()) {
            this.addClosedEdges(wires);
        } else {
            this.addUnclosedEdges(wires, this.shapes as IEdge[]);
        }

        return wires;
    }

    private addClosedEdges(wires: IWire[]): void {
        for (const shape of this.shapes) {
            if (shape.shapeType === ShapeType.Wire) {
                wires.push(shape as IWire);
            } else {
                this.addUnclosedEdges(wires, [shape as IEdge]);
            }
        }
    }

    private addUnclosedEdges(wires: IWire[], edges: IEdge[]): void {
        const wire = this.document.application.shapeFactory.wire(edges);
        if (!wire.isOk) throw new Error("Cannot create wire from open shapes");
        wires.push(wire.value);
    }

    override generateShape(): Result<IShape> {
        if (this.shapes.length === 0) return Result.err("No shapes to create face");

        const wires = this.getWires();
        return this.document.application.shapeFactory.face(wires);
    }
}
