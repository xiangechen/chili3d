// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Plane, XYZ, command } from "chili-core";
import { PyramidNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { RectCommandBase } from "./rect";

@command({
    key: "create.pyramid",
    icon: "icon-pyramid",
})
export class Pyramid extends RectCommandBase {
    protected override getSteps(): IStep[] {
        let steps = super.getSteps();
        let third = new LengthAtAxisStep("prompt.pickNextPoint", this.getHeightStepData);
        return [...steps, third];
    }

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        const plane = this.stepDatas[1].plane;
        if (plane === undefined) {
            throw new Error("plane is undefined, please report bug");
        }
        const point = this.stepDatas[1].point!.add(this.stepDatas[0].point!).multiply(0.5);
        return {
            point,
            direction: plane.normal,
            preview: this.previewPyramid,
        };
    };

    private readonly previewPyramid = (end: XYZ | undefined) => {
        if (!end) {
            return this.previewRect(this.stepDatas[1].point);
        }

        const data = this.rectDataFromTwoSteps();
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(this.stepDatas[1].point!),
            this.meshCreatedShape("pyramid", data.plane, data.dx, data.dy, this.getHeight(data.plane, end)),
        ];
    };

    protected override geometryNode(): GeometryNode {
        const rect = this.rectDataFromTwoSteps();
        const dz = this.getHeight(rect.plane, this.stepDatas[2].point!);
        return new PyramidNode(this.document, rect.plane, rect.dx, rect.dy, dz);
    }

    private getHeight(plane: Plane, point: XYZ): number {
        return point.sub(plane.origin).dot(plane.normal);
    }
}
