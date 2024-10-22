// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Matrix4, Plane, ShapeMeshData, XYZ, command } from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    name: "modify.mirror",
    display: "command.mirror",
    icon: "icon-mirror",
})
export class Mirror extends TransformedCommand {
    protected override transfrom(point: XYZ): Matrix4 {
        let center = this.stepDatas[0].point!;
        let xvec = this.stepDatas[0].view.workplane.normal;
        let yvec = point.sub(center);
        let normal = yvec.cross(xvec);
        let plane = new Plane(center, normal, xvec);
        return Matrix4.createMirrorWithPlane(plane);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2,
            preview: this.mirrorPreview,
            validators: [
                (p) => {
                    let vec = p.sub(this.stepDatas[0].point!);
                    return vec.length() > 1e-3 && !vec.isParallelTo(this.stepDatas[0].view.workplane.normal);
                },
            ],
        };
    };

    private readonly mirrorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        let shape = this.transformPreview(point);
        let offset = point.sub(this.stepDatas[0].point!).normalize()!.multiply(1e6);
        let line = this.getTempLineData(this.stepDatas[0].point!.sub(offset), point.add(offset));
        return [p1, shape, line];
    };
}
