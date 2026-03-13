// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    command,
    type GeometryNode,
    type IEdge,
    type ILine,
    type IShape,
    type IShapeFilter,
    type IStep,
    Line,
    property,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
} from "@chili3d/core";
import { RevolvedNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.revol",
    icon: "icon-revolve",
})
export class Revolve extends CreateCommand {
    @property("common.angle")
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
        const axis = new Line({
            point: transform.ofPoint(edge.value(0)),
            direction: transform.ofVector(edge.direction),
        });
        return new RevolvedNode({ document: this.document, profile: shape, axis, angle: this.angle });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                (ShapeTypes.edge | ShapeTypes.face | ShapeTypes.wire) as ShapeType,
                "prompt.select.shape",
            ),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.edges", {
                shapeFilter: new LineFilter(),
                keepSelection: true,
            }),
        ];
    }
}

class LineFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType === ShapeTypes.edge) {
            const edge = shape as IEdge;
            const curve = edge.curve.basisCurve;
            return CurveUtils.isLine(curve);
        }
        return false;
    }
}
