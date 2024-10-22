// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { CircleNode } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateFaceableCommand } from "../createCommand";

@command({
    name: "create.circle",
    display: "command.circle",
    icon: "icon-circle",
})
export class Circle extends CreateFaceableCommand {
    getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        return [centerStep, radiusStep];
    }

    private getRadiusData = (): SnapLengthAtPlaneData => {
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

    protected override geometryNode(): GeometryNode {
        let [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        let plane = this.stepDatas[0].view.workplane;
        let body = new CircleNode(this.document, plane.normal, p1, this.getDistanceAtPlane(plane, p1, p2));
        body.isFace = this.isFace;
        return body;
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
