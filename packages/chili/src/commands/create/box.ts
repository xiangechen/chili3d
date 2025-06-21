// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { BoxNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { RectCommandBase } from "./rect";

@command({
    key: "create.box",
    icon: "icon-box",
})
export class Box extends RectCommandBase {
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
        return {
            point: this.stepDatas[1].point!,
            direction: plane.normal,
            preview: this.previewBox,
        };
    };

    private readonly previewBox = (end: XYZ | undefined) => {
        if (!end) {
            return this.previewRect(this.stepDatas[1].point);
        }

        const { plane, dx, dy } = this.rectDataFromTwoSteps();
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(this.stepDatas[1].point!),
            this.meshCreatedShape("box", plane, dx, dy, this.getHeight(plane, end)),
        ];
    };

    protected override geometryNode(): GeometryNode {
        const rect = this.rectDataFromTwoSteps();
        const dz = this.getHeight(rect.plane, this.stepDatas[2].point!);
        return new BoxNode(this.document, rect.plane, rect.dx, rect.dy, dz);
    }

    private getHeight(plane: Plane, point: XYZ): number {
        const h = point.sub(this.stepDatas[1].point!).dot(plane.normal);
        if (Math.abs(h) < Precision.Distance) {
            return h < 0 ? -0.00001 : 0.00001;
        }
        return h;
    }
}
