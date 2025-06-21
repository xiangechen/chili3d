// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    GeometryNode,
    ICurve,
    IEdge,
    ILine,
    IShape,
    IShapeFilter,
    Property,
    Ray,
    ShapeType,
    command,
} from "chili-core";
import { RevolvedNode } from "../../bodys";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    key: "convert.revol",
    icon: "icon-revolve",
})
export class Revolve extends CreateCommand {
    @Property.define("common.angle")
    public get angle() {
        return this.getPrivateValue("angle", 360);
    }
    public set angle(value: number) {
        this.setProperty("angle", value);
    }

    protected override geometryNode(): GeometryNode {
        const shape = this.transformdFirstShape(this.stepDatas[0], false);
        const edge = (this.stepDatas[1].shapes[0].shape as IEdge).curve.basisCurve as ILine;
        const transform = this.stepDatas[1].shapes[0].transform;
        const axis = new Ray(transform.ofPoint(edge.value(0)), transform.ofVector(edge.direction));
        return new RevolvedNode(this.document, shape, axis, this.angle);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge | ShapeType.Face | ShapeType.Wire, "prompt.select.shape"),
            new SelectShapeStep(ShapeType.Edge, "prompt.select.edges", {
                shapeFilter: new LineFilter(),
                keepSelection: true,
            }),
        ];
    }
}

class LineFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType === ShapeType.Edge) {
            let edge = shape as IEdge;
            let curve = edge.curve.basisCurve;
            return ICurve.isLine(curve);
        }
        return false;
    }
}
