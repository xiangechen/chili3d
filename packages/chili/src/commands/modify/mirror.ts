// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Matrix4, Plane, ShapeMeshData, XYZ, command } from "chili-core";
import { Dimension, SnapPointData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    name: "Mirror",
    display: "command.mirror",
    icon: "icon-mirror",
})
export class Mirror extends TransformedCommand {
    protected override transfrom(point: XYZ): Matrix4 {
        let center = this.stepDatas[0].point;
        let xvec = this.stepDatas[0].view.workplane.normal;
        let yvec = point.sub(center);
        let normal = yvec.cross(xvec);
        let plane = new Plane(center, normal, xvec);
        return Matrix4.createMirrorWithPlane(plane);
    }

    protected override isClone(): boolean {
        return false;
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private getSecondPointData = (): SnapPointData => {
        return {
            refPoint: this.stepDatas[0].point,
            dimension: Dimension.D1D2D3,
            preview: this.mirrorPreview,
            validator: (p) => p.distanceTo(this.stepDatas[0].point) > 1e-3,
        };
    };

    private mirrorPreview = (point: XYZ): ShapeMeshData[] => {
        let shape = this.transformPreview(point);
        let offset = point.sub(this.stepDatas[0].point).normalize()!.multiply(1e6);
        let line = this.getTempLineData(this.stepDatas[0].point.sub(offset), point.add(offset));
        return [shape, line];
    };
}
