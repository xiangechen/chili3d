// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { ConeNode } from "../../bodys";
import { LengthAtAxisSnapData, SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtAxisStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.cone",
    display: "command.cone",
    icon: "icon-box",
})
export class Cone extends CreateCommand {
    protected override getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        let third = new LengthAtAxisStep("operate.pickNextPoint", this.getHeightStepData);
        return [centerStep, radiusStep, third];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.circlePreview,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validator: (p: XYZ) => {
                if (p.distanceTo(point) < Precision.Distance) return false;
                return p.sub(point).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
            },
        };
    };

    private readonly circlePreview = (point: XYZ | undefined) => {
        const p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [p1];

        const start = this.stepDatas[0].point!;
        const plane = this.stepDatas[0].view.workplane;
        return [
            p1,
            this.previewLine(start, point),
            this.application.shapeFactory.circle(
                plane.normal,
                start,
                this.getDistanceAtPlane(plane, start, point),
            ).value.mesh.edges!,
        ];
    };

    private getDistanceAtPlane(plane: Plane, p1: XYZ, p2: XYZ) {
        let dp1 = plane.project(p1);
        let dp2 = plane.project(p2);
        return dp1.distanceTo(dp2);
    }

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        return {
            point: this.stepDatas[1].point!,
            direction: this.stepDatas[0].view.workplane.normal,
            preview: this.previewCylinder,
        };
    };

    private readonly previewCylinder = (end: XYZ | undefined) => {
        const center = this.stepDatas[0].point!;
        const point2 = this.stepDatas[1].point!;
        if (!end) {
            return this.circlePreview(point2);
        }
        const p1 = this.previewPoint(center);
        const p2 = this.previewPoint(point2);
        const plane = this.stepDatas[0].view.workplane;
        const radius = this.getDistanceAtPlane(plane, this.stepDatas[0].point!, this.stepDatas[1].point!);
        const height = this.getHeight(plane, end);
        return [
            p1,
            p2,
            this.application.shapeFactory.cone(
                height < 0 ? plane.normal.reverse() : plane.normal,
                center,
                radius,
                0,
                Math.abs(height),
            ).value.mesh.edges!,
        ];
    };

    protected override geometryNode(): GeometryNode {
        const plane = this.stepDatas[0].view.workplane;
        const radius = this.getDistanceAtPlane(plane, this.stepDatas[0].point!, this.stepDatas[1].point!);
        const height = this.getHeight(plane, this.stepDatas[2].point!);
        return new ConeNode(
            this.document,
            height < 0 ? plane.normal.reverse() : plane.normal,
            this.stepDatas[0].point!,
            radius,
            Math.abs(height),
        );
    }

    private getHeight(plane: Plane, point: XYZ): number {
        return point.sub(this.stepDatas[1].point!).dot(plane.normal);
    }
}
