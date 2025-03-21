// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { SphereNode } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.sphere",
    display: "command.sphere",
    icon: "icon-box",
})
export class Sphere extends CreateCommand {
    protected override getSteps(): IStep[] {
        let centerStep = new PointStep("operate.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("operate.pickRadius", this.getRadiusData);
        return [centerStep, radiusStep];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.previewSphere,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validator: (p: XYZ) => {
                if (p.distanceTo(point) < Precision.Distance) return false;
                return p.sub(point).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
            },
        };
    };

    private getDistanceAtPlane(plane: Plane, p1: XYZ, p2: XYZ) {
        let dp1 = plane.project(p1);
        let dp2 = plane.project(p2);
        return dp1.distanceTo(dp2);
    }

    private readonly previewSphere = (end: XYZ | undefined) => {
        const p1 = this.previewPoint(this.stepDatas[0].point!);
        const center = this.stepDatas[0].point!;
        if (!end) {
            return [p1];
        }

        const plane = this.stepDatas[0].view.workplane;
        const radius = this.getDistanceAtPlane(plane, this.stepDatas[0].point!, end!);

        return [p1, this.application.shapeFactory.sphere(center, radius).value.mesh.edges!];
    };

    protected override geometryNode(): GeometryNode {
        const plane = this.stepDatas[0].view.workplane;
        const radius = this.getDistanceAtPlane(plane, this.stepDatas[0].point!, this.stepDatas[1].point!);
        return new SphereNode(this.document, plane.normal, this.stepDatas[0].point!, radius);
    }
}
