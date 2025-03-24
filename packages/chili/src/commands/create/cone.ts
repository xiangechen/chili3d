// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EdgeMeshData,
    GeometryNode,
    LineType,
    Plane,
    Precision,
    VisualConfig,
    XYZ,
    command,
} from "chili-core";
import { ConeNode } from "../../bodys";
import { LengthAtAxisSnapData, SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtAxisStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.cone",
    display: "command.cone",
    icon: "icon-cone",
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
            plane: (p: XYZ | undefined) => this.findPlane(this.stepDatas[0].view, point, p),
            validator: (p: XYZ) => {
                if (p.distanceTo(point) < Precision.Distance) return false;
                const plane = this.findPlane(this.stepDatas[0].view, point, p);
                return p.sub(point).isParallelTo(plane.normal) === false;
            },
        };
    };

    private readonly circlePreview = (point: XYZ | undefined) => {
        const p1 = this.previewPoint(this.stepDatas[0].point!);
        if (!point) return [p1];

        const start = this.stepDatas[0].point!;
        const plane = this.findPlane(this.stepDatas[0].view, start, point);
        return [
            p1,
            this.previewLine(start, point),
            this.application.shapeFactory.circle(plane.normal, start, plane.projectDistance(start, point))
                .value.mesh.edges!,
        ];
    };

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        return {
            point: this.stepDatas[0].point!,
            direction: this.stepDatas[1].plane!.normal,
            preview: this.previewCone,
        };
    };

    private readonly previewCone = (end: XYZ | undefined) => {
        if (!end) {
            return this.circlePreview(this.stepDatas[1].point);
        }
        const center = this.stepDatas[0].point!;
        const p1Visual = this.previewPoint(center);
        const plane = this.stepDatas[1].plane!;
        const radius = plane.projectDistance(center, this.stepDatas[1].point!);
        const up = center.add(plane.normal.multiply(this.getHeight(plane, end)));
        return [
            p1Visual,
            this.application.shapeFactory.circle(plane.normal, center, radius).value.mesh.edges!,
            this.previewLine(center.add(plane.xvec.multiply(radius)), up),
            this.previewLine(center.add(plane.xvec.multiply(-radius)), up),
            this.previewLine(center.add(plane.yvec.multiply(radius)), up),
            this.previewLine(center.add(plane.yvec.multiply(-radius)), up),
        ];
    };

    protected override previewLine(start: XYZ, end: XYZ) {
        return EdgeMeshData.from(start, end, VisualConfig.defaultEdgeColor, LineType.Solid);
    }

    protected override geometryNode(): GeometryNode {
        const plane = this.stepDatas[1].plane!;
        const radius = plane.projectDistance(this.stepDatas[0].point!, this.stepDatas[1].point!);
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
        return point.sub(this.stepDatas[0].point!).dot(plane.normal);
    }
}
