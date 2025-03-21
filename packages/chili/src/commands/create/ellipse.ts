// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { EllipseNode } from "../../bodys/ellipse";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateFaceableCommand } from "../createCommand";

@command({
    name: "create.ellipse",
    display: "command.ellipse",
    icon: "icon-circle",
})
export class Ellipse extends CreateFaceableCommand {
    getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStepX = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        let radiusStepY = new LengthAtPlaneStep("operate.pickRadius", this.getEllipseData);
        return [centerStep, radiusStepX, radiusStepY];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.previewPoints,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validator: (p: XYZ) => {
                if (p.distanceTo(point) < Precision.Distance) return false;
                return p.sub(point).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
            },
        };
    };
    protected previewPoints = (end: XYZ | undefined) => {
        const p1 = this.previewPoint(this.stepDatas[0].point!);
        if (end === undefined) return [p1];
        const p2 = this.previewPoint(end);
        return [p1, p2];
    };
    private readonly getEllipseData = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        const p1 = this.stepDatas[1].point!;
        return {
            point: () => point,
            preview: this.ellipsePreview,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validator: (p: XYZ) => {
                if (p.distanceTo(point) < Precision.Distance) return false;
                if (p.sub(point).isParallelTo(this.stepDatas[0].view.workplane.normal)) return false;
                // Ensure that the long half axis is greater than the short half axis
                if (
                    this.getDistanceAtPlane(this.stepDatas[0].view.workplane, point, p1) <
                    this.getDistanceAtPlane(this.stepDatas[0].view.workplane, point, p)
                )
                    return false;
                return true;
            },
        };
    };

    protected override geometryNode(): GeometryNode {
        const [p0, p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!, this.stepDatas[2].point!];
        const plane = this.stepDatas[0].view.workplane;
        const body = new EllipseNode(
            this.document,
            plane.normal,
            p0,
            this.getDistanceAtPlane(plane, p0, p1),
            this.getDistanceAtPlane(plane, p0, p2),
        );
        body.isFace = this.isFace;
        return body;
    }

    private readonly ellipsePreview = (point: XYZ | undefined) => {
        const center = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [center];

        const p0 = this.stepDatas[0].point!;
        const p1 = this.stepDatas[1].point!;
        const plane = this.stepDatas[0].view.workplane;

        return [
            center,
            this.previewPoint(p1),
            this.application.shapeFactory.ellipse(
                plane.normal,
                p0,
                this.getDistanceAtPlane(plane, p0, p1),
                this.getDistanceAtPlane(plane, p0, point),
            ).value.mesh.edges!,
        ];
    };

    private getDistanceAtPlane(plane: Plane, p1: XYZ, p2: XYZ) {
        let dp1 = plane.project(p1);
        let dp2 = plane.project(p2);
        return dp1.distanceTo(dp2);
    }
}
