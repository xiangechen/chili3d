// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Matrix4, Plane, PlaneAngle, Precision, ShapeMeshData, XYZ, command } from "chili-core";
import { Dimension, SnapLengthAtPlaneData } from "../../snap";
import { AngleStep, IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { TransformedCommand } from "./transformedCommand";

@command({
    name: "modify.rotate",
    display: "command.rotate",
    icon: "icon-rotate",
})
export class Rotate extends TransformedCommand {
    private _planeAngle: PlaneAngle | undefined;

    protected override transfrom(point: XYZ): Matrix4 {
        const normal = this.stepDatas[1].plane!.normal;
        const center = this.stepDatas[0].point!;
        const angle = (this._planeAngle?.angle! * Math.PI) / 180;
        return Matrix4.createRotationAt(center, normal, angle);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new LengthAtPlaneStep("operate.pickNextPoint", this.getSecondPointData);
        let thirdStep = new AngleStep(
            "operate.pickNextPoint",
            () => this.stepDatas[0].point!,
            () => this.stepDatas[1].point!,
            this.getAngleData,
        );
        return [firstStep, secondStep, thirdStep];
    }

    private readonly getSecondPointData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.circlePreview,
            plane: (p: XYZ | undefined) => this.findPlane(view, point!, p),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                return p.sub(point!).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
            },
        };
    };

    private readonly getAngleData = () => {
        const [center, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const plane = this.stepDatas[1].plane ?? this.findPlane(this.stepDatas[1].view, center, p1);
        const points: ShapeMeshData[] = [this.meshPoint(center), this.meshPoint(p1)];
        this._planeAngle = new PlaneAngle(new Plane(center, plane.normal, p1.sub(center)));
        return {
            dimension: Dimension.D1D2,
            preview: (point: XYZ | undefined) => this.anglePreview(point, center, p1, points),
            plane: () => plane,
        };
    };

    private anglePreview(
        point: XYZ | undefined,
        center: XYZ,
        p1: XYZ,
        points: ShapeMeshData[],
    ): ShapeMeshData[] {
        point = point ?? p1;
        this._planeAngle!.movePoint(point);
        const result = [...points];
        if (Math.abs(this._planeAngle!.angle) > Precision.Angle) {
            result.push(
                this.meshCreatedShape(
                    "arc",
                    this._planeAngle!.plane.normal,
                    center,
                    p1,
                    this._planeAngle!.angle,
                ),
                this.transformPreview(point),
            );
        }
        return result;
    }

    private readonly circlePreview = (end: XYZ | undefined) => {
        const visualCenter = this.meshPoint(this.stepDatas[0].point!);
        if (!end) return [visualCenter];
        const { point, view } = this.stepDatas[0];
        const plane = this.findPlane(view, point!, end);
        return [
            visualCenter,
            this.meshLine(this.stepDatas[0].point!, end),
            this.meshCreatedShape("circle", plane.normal, point!, plane.projectDistance(point!, end)),
        ];
    };
}
