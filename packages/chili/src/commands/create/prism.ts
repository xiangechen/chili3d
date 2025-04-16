// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Precision, ShapeType, command } from "chili-core";
import { GeoUtils } from "chili-geo";
import { PrismNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.prism",
    display: "command.prism",
    icon: "icon-prism",
})
export class Prism extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        const shape = this.stepDatas[0].shapes[0].shape;
        const { point, normal } = this.getAxis();
        const dist = this.stepDatas[1].point!.sub(point).dot(normal);
        return new PrismNode(this.document, shape, dist);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Face | ShapeType.Edge | ShapeType.Wire, "prompt.select.shape"),
            new LengthAtAxisStep("operate.pickNextPoint", this.getLengthStepData),
        ];
    }

    private readonly getLengthStepData = (): LengthAtAxisSnapData => {
        const { point, normal } = this.getAxis();
        return {
            point,
            direction: normal,
            preview: (p) => {
                if (!p) return [];
                const dist = p.sub(point).dot(normal);
                if (Math.abs(dist) < Precision.Float) return [];
                const vec = normal.multiply(dist);
                const shape = this.stepDatas[0].shapes[0].shape;
                return [this.meshCreatedShape("prism", shape, vec)];
            },
        };
    };

    private getAxis() {
        const point = this.stepDatas[0].shapes[0].point!;
        const shape = this.stepDatas[0].shapes[0].shape;
        const normal = GeoUtils.normal(shape as any);
        return { point, normal };
    }
}
