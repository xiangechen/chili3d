// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, PlaneAngle, Precision, ShapeMeshData, XYZ, command } from "chili-core";
import { ArcNode } from "../../bodys/arc";
import { Dimension, SnapLengthAtPlaneData } from "../../snap";
import { AngleStep, IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.arc",
    display: "command.arc",
    icon: "icon-arc",
})
export class Arc extends CreateCommand {
    private _planeAngle: PlaneAngle | undefined;

    getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let startStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        let angleStep = new AngleStep(
            "operate.pickNextPoint",
            () => this.stepDatas[0].point!,
            () => this.stepDatas[1].point!,
            this.getAngleData,
        );
        return [centerStep, startStep, angleStep];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        let point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.circlePreview,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validators: [
                (p: XYZ) => {
                    if (p.distanceTo(point) < Precision.Distance) return false;
                    return p.sub(point).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
                },
            ],
        };
    };

    private readonly getAngleData = () => {
        let [center, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        let plane = new Plane(center, this.stepDatas[0].view.workplane.normal, p1.sub(center));
        let points: ShapeMeshData[] = [this.previewPoint(center), this.previewPoint(p1)];
        this._planeAngle = new PlaneAngle(plane);
        return {
            dimension: Dimension.D1D2,
            preview: (point: XYZ | undefined) => {
                if (point === undefined) {
                    point = p1;
                }
                this._planeAngle!.movePoint(point);
                let result = [...points];
                if (Math.abs(this._planeAngle!.angle) > Precision.Angle) {
                    result.push(
                        this.application.shapeFactory.arc(plane.normal, center, p1, this._planeAngle!.angle)
                            .value.mesh.edges!,
                    );
                }
                return result;
            },
            plane: () => plane,
            validators: [
                (p: XYZ) => {
                    if (p.distanceTo(center) < Precision.Distance) return false;
                    return p.sub(center).isParallelTo(plane.normal) === false;
                },
            ],
        };
    };

    protected override geometryNode(): GeometryNode {
        let [p0, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        let plane = this.stepDatas[0].view.workplane;
        this._planeAngle?.movePoint(this.stepDatas[2].point!);
        return new ArcNode(this.document, plane.normal, p0, p1, this._planeAngle!.angle);
    }

    private readonly circlePreview = (point: XYZ | undefined) => {
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) {
            return [p1];
        }
        let start = this.stepDatas[0].point!;
        let plane = this.stepDatas[0].view.workplane;
        return [
            p1,
            this.previewLine(this.stepDatas[0].point!, point),
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
}
