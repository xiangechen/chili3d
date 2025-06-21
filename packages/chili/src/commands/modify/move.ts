// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, XYZ, command } from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    key: "modify.move",
    icon: "icon-move",
})
export class Move extends TransformedCommand {
    getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickFistPoint", undefined, true),
            new PointStep("prompt.pickNextPoint", this.getSecondPointData, true),
        ];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            preview: this.movePreview,
        };
    };

    private readonly movePreview = (point: XYZ | undefined) => {
        const p1 = this.meshPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        return [p1, this.transformPreview(point), this.getTempLineData(this.stepDatas[0].point!, point)];
    };

    protected override transfrom(point: XYZ): Matrix4 {
        const { x, y, z } = point.sub(this.stepDatas[0].point!);
        return Matrix4.fromTranslation(x, y, z);
    }
}
