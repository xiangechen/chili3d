// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Colors,
    GeometryModel,
    Plane,
    PlaneAngle,
    Precision,
    ShapeMeshData,
    VertexMeshData,
    XYZ,
    command,
} from "chili-core";
import { ArcBody } from "../../bodys/arcBody";
import { Dimension, SnapLengthAtPlaneData } from "../../snap";
import { AngleStep, IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";

@command({
    name: "create.arc",
    display: "command.arc",
    icon: "icon-arc",
})
export class Arc extends CreateCommand {
    private static count: number = 1;
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

    private getRadiusData = (): SnapLengthAtPlaneData => {
        let point = this.stepDatas[0].point!;
        return {
            point,
            preview: this.circlePreview,
            plane: this.stepDatas[0].view.workplane.translateTo(point),
            validators: [
                (p: XYZ) => {
                    if (p.distanceTo(point) < Precision.Distance) return false;
                    return p.sub(point).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
                },
            ],
        };
    };

    private getAngleData = () => {
        let [center, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        let plane = new Plane(center, this.stepDatas[0].view.workplane.normal, p1.sub(center));
        let points: ShapeMeshData[] = [
            VertexMeshData.from(center, 5, Colors.Red),
            VertexMeshData.from(p1, 5, Colors.Red),
        ];
        this._planeAngle = new PlaneAngle(plane);
        return {
            dimension: Dimension.D1D2,
            preview: (point: XYZ) => {
                this._planeAngle!.movePoint(point);
                let result = [...points];
                if (Math.abs(this._planeAngle!.angle) > Precision.Angle) {
                    result.push(
                        this.application.shapeFactory
                            .arc(plane.normal, center, p1, this._planeAngle!.angle)
                            .unwrap().mesh.edges!,
                    );
                }
                return result;
            },
            plane,
            validators: [
                (p: XYZ) => {
                    if (p.distanceTo(center) < Precision.Distance) return false;
                    return p.sub(center).isParallelTo(plane.normal) === false;
                },
            ],
        };
    };

    create(): GeometryModel {
        let [p0, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        let plane = this.stepDatas[0].view.workplane;
        this._planeAngle?.movePoint(this.stepDatas[2].point!);
        let body = new ArcBody(this.document, plane.normal, p0, p1, this._planeAngle!.angle);
        return new GeometryModel(this.document, `Arc ${Arc.count++}`, body);
    }

    private circlePreview = (point: XYZ) => {
        let start = this.stepDatas[0].point!;
        let plane = this.stepDatas[0].view.workplane;
        return [
            this.application.shapeFactory
                .circle(plane.normal, start, this.getDistanceAtPlane(plane, start, point))
                .unwrap().mesh.edges!,
        ];
    };

    private getDistanceAtPlane(plane: Plane, p1: XYZ, p2: XYZ) {
        let dp1 = plane.project(p1);
        let dp2 = plane.project(p2);
        return dp1.distanceTo(dp2);
    }
}
