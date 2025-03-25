// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Matrix4, ShapeMeshData, XYZ, command } from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { AngleStep, IStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    name: "modify.rotate",
    display: "command.rotate",
    icon: "icon-rotate",
})
export class Rotate extends TransformedCommand {
    protected override transfrom(point: XYZ): Matrix4 {
        const normal = this.stepDatas[0].view.workplane.normal;
        const center = this.stepDatas[0].point!;
        const p1 = this.stepDatas[1].point!;
        const v1 = p1.sub(center);
        const v2 = point.sub(center);
        const angle = v1.angleOnPlaneTo(v2, normal)!;
        return Matrix4.createRotationAt(center, normal, angle);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        let thirdStep = new AngleStep(
            "operate.pickNextPoint",
            () => this.stepDatas[0].point!,
            () => this.stepDatas[1].point!,
            this.getThirdPointData,
        );
        return [firstStep, secondStep, thirdStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            plane: () => this.stepDatas[0].view.workplane.translateTo(this.stepDatas[0].point!),
            preview: this.linePreview,
            validator: (p) => p.distanceTo(this.stepDatas[0].point!) > 1e-6,
        };
    };

    private readonly getThirdPointData = (): PointSnapData => {
        return {
            dimension: Dimension.D1D2,
            preview: this.rotatePreview,
            plane: () => this.stepDatas[0].view.workplane.translateTo(this.stepDatas[0].point!),
            validator: (p) => {
                return (
                    p.distanceTo(this.stepDatas[0].point!) > 1e-3 &&
                    p.distanceTo(this.stepDatas[1].point!) > 1e-3
                );
            },
        };
    };

    private readonly rotatePreview = (point: XYZ | undefined): ShapeMeshData[] => {
        let p1 = this.meshPoint(this.stepDatas[0].point!);
        let l1 = this.getRayData(this.stepDatas[1].point!);
        let result = [p1, l1, this.meshPoint(this.stepDatas[1].point!)];
        if (point) {
            let shape = this.transformPreview(point);
            let l2 = this.getRayData(point);
            result.push(l2, shape);
        }
        return result;
    };

    private getRayData(end: XYZ) {
        let start = this.stepDatas[0].point!;
        let e = start.add(end.sub(start).normalize()!.multiply(1e6));
        return this.getTempLineData(start, e);
    }

    private readonly linePreview = (point: XYZ | undefined): ShapeMeshData[] => {
        let p1 = this.meshPoint(this.stepDatas[0].point!);
        if (!point) {
            return [p1];
        }
        return [p1, this.getTempLineData(this.stepDatas[0].point!, point)];
    };
}
