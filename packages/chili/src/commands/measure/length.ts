// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Precision, VisualConfig, XYZ } from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "measure.length",
    icon: "icon-measureLength",
})
export class LengthMeasure extends MultistepCommand {
    protected override getSteps(): IStep[] {
        let firstStep = new PointStep("prompt.pickFistPoint");
        let secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.linePreview,
        };
    };

    private readonly linePreview = (point: XYZ | undefined) => {
        if (!point) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };

    protected override executeMainTask(): void {
        const firstPoint = this.stepDatas[0].point!;
        const secondPoint = this.stepDatas[1].point!;
        const distance = firstPoint.distanceTo(secondPoint);
        const visualId = this.document.visual.context.displayMesh([
            this.meshPoint(firstPoint),
            this.meshLine(firstPoint, secondPoint, VisualConfig.highlightEdgeColor, 3),
            this.meshPoint(secondPoint),
        ]);
        this.application.activeView?.htmlText(
            distance.toFixed(2),
            firstPoint.add(secondPoint).multiply(0.5),
            {
                onDispose: () => {
                    this.document.visual.context.removeMesh(visualId);
                },
            },
        );
    }
}
