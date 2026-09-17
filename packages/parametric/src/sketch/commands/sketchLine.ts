// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Dimensions, type IStep, type XYZ } from "@chili3d/core";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/** Line params in sketch uv for the endpoints `start` and `end`. */
function lineParams(start: [number, number], end: [number, number]): [number, number, number, number] {
    return [start[0], start[1], end[0], end[1]];
}

@command({ key: "sketch.line", icon: "icon-line" })
export class SketchLineCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickFistPoint"),
            new SketchPointStep("prompt.pickNextPoint", this.getSecondPointData),
        ];
    }

    protected executeMainTask(): void {
        this.commitNewEntity(this.editor.solver.addLine(...lineParams(this.uvOf(0), this.uvOf(1))));
    }

    private readonly getSecondPointData = (): SketchPointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: this.linePreview,
        tentative: (probe) => ({ type: "line", params: lineParams(this.uvOf(0), probe) }),
    });

    private readonly linePreview = (point: XYZ | undefined) => {
        if (point === undefined) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };
}
