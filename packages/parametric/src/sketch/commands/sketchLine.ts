// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Dimensions, type IStep, type PointSnapData, type XYZ } from "@chili3d/core";
import { toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { SketchPointStep } from "./sketchPointStep";

@command({ key: "sketch.line", icon: "icon-line" })
export class SketchLineCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickNextPoint", this.getSecondPointData),
        ];
    }

    protected executeMainTask(): void {
        const plane = this.editor.node.plane;
        const [u1, v1] = toUV(plane, this.stepDatas[0].point!);
        const [u2, v2] = toUV(plane, this.stepDatas[1].point!);
        this.commitNewEntity(this.editor.solver.addLine(u1, v1, u2, v2));
    }

    private readonly getSecondPointData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: this.linePreview,
    });

    private readonly linePreview = (point: XYZ | undefined) => {
        if (point === undefined) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };
}
