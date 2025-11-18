// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Matrix4, Plane, type ShapeMeshData, type XYZ } from "chili-core";
import { Dimension, type PointSnapData } from "../../snap";
import { type IStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    key: "modify.mirror",
    icon: "icon-mirror",
})
export class Mirror extends TransformedCommand {
    protected override transfrom(point: XYZ): Matrix4 {
        const center = this.stepDatas[0].point!;
        const xvec = this.stepDatas[0].view.workplane.normal;
        const yvec = point.sub(center);
        const normal = yvec.cross(xvec);
        const plane = new Plane(center, normal, xvec);
        return Matrix4.createMirrorWithPlane(plane);
    }

    getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint", undefined, true);
        const secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData, true);
        return [firstStep, secondStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2,
            preview: this.mirrorPreview,
            validator: (p) => {
                const vec = p.sub(this.stepDatas[0].point!);
                return vec.length() > 1e-3 && !vec.isParallelTo(this.stepDatas[0].view.workplane.normal);
            },
        };
    };

    private readonly mirrorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const p1 = this.meshPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        const shape = this.transformPreview(point);
        const offset = point.sub(this.stepDatas[0].point!).normalize()!.multiply(1e6);
        const line = this.getTempLineData(this.stepDatas[0].point!.sub(offset), point.add(offset));
        return [p1, shape, line];
    };
}
