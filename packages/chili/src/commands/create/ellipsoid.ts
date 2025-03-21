// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { EllipsoidNode } from "../../bodys";
import { LengthAtAxisSnapData, SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtAxisStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.ellipsoid",
    display: "command.ellipsoid",
    icon: "icon-box",
})
export class ellipsoid extends CreateCommand {
    protected override getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let xStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        let yStep = new LengthAtPlaneStep("operate.pickRadius", this.getEllipseData);
        let zStep = new LengthAtAxisStep("operate.pickRadius", this.getEllipsoidData);
        return [centerStep, xStep, yStep, zStep];
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
    private readonly getEllipsoidData = (): LengthAtAxisSnapData => {
        const point = this.stepDatas[0].point!;
        const p1 = this.stepDatas[1].point!;
        return {
            point: this.stepDatas[1].point!,
            direction: this.stepDatas[0].view.workplane.normal,
            preview: this.ellipsePreview,
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

    private readonly ellipsePreview = (point: XYZ | undefined) => {
        const center = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [center];

        const p0 = this.stepDatas[0].point!;
        const p1 = this.stepDatas[1].point!;
        const plane = this.stepDatas[0].view.workplane;

        return [
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

    protected override geometryNode(): GeometryNode {
        const plane = this.stepDatas[0].view.workplane;
        const radiusX = this.getDistanceAtPlane(plane, this.stepDatas[0].point!, this.stepDatas[1].point!);
        const radiusY = this.getDistanceAtPlane(plane, this.stepDatas[0].point!, this.stepDatas[2].point!);
        const height = this.getHeight(plane, this.stepDatas[3].point!);
        return new EllipsoidNode(
            this.document,
            plane.normal,
            this.stepDatas[0].point!,
            plane.xvec,
            radiusX,
            radiusY,
            height,
        );
    }

    private getHeight(plane: Plane, point: XYZ): number {
        return point.sub(this.stepDatas[1].point!).dot(plane.normal);
    }
}
