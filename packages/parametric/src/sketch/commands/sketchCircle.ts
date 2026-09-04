// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Dimensions, type IStep, type PointSnapData, type XYZ } from "@chili3d/core";
import { toUV } from "../sketchModel";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { SketchPointStep } from "./sketchPointStep";

@command({ key: "sketch.circle", icon: "icon-circle" })
export class SketchCircleCommand extends SketchMultistepCommand {
    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickCircleCenter"),
            new SketchPointStep("prompt.pickRadius", this.getRadiusData),
        ];
    }

    protected executeMainTask(): void {
        const plane = this.editor.node.plane;
        const center = this.stepDatas[0].point!;
        const [cx, cy] = toUV(plane, center);
        const radius = plane.projectDistance(center, this.stepDatas[1].point!);
        this.commitNewEntity(this.editor.solver.addCircle(cx, cy, radius));
    }

    private readonly getRadiusData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1,
        preview: this.circlePreview,
    });

    private readonly circlePreview = (point: XYZ | undefined) => {
        const center = this.stepDatas[0].point!;
        if (point === undefined) {
            return [this.meshPoint(center)];
        }
        const plane = this.editor.node.plane;
        return [
            this.meshPoint(center),
            this.meshLine(center, point),
            this.meshCreatedShape("circle", plane.normal, center, plane.projectDistance(center, point)),
        ];
    };
}
