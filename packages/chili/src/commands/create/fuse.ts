// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, IFace, Precision, ShapeType, command } from "chili-core";
import { PrismNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    key: "convert.fuse",
    icon: "icon-circle",
})
export class Fuse extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let shape = this.stepDatas[0].shapes[0].shape as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        let dist = this.stepDatas[1].point!.sub(point).dot(normal);
        return new PrismNode(this.document, shape, dist);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Face, "prompt.select.faces"),
            new LengthAtAxisStep("prompt.pickNextPoint", this.getLengthStepData),
        ];
    }

    private getLengthStepData = (): LengthAtAxisSnapData => {
        let shape = this.stepDatas[0].shapes[0].shape as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        return {
            point,
            direction: normal,
            preview: (p) => {
                if (!p) return [];
                let dist = p.sub(point).dot(normal);
                if (Math.abs(dist) < Precision.Float) return [];
                let vec = normal.multiply(dist);
                return [this.application.shapeFactory.prism(shape, vec).value.mesh.edges!];
            },
        };
    };
}
