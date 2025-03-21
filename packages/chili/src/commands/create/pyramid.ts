// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, XYZ, command } from "chili-core";
import { PyramidNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { RectCommandBase } from "./rect";

@command({
    name: "create.pyramid",
    display: "command.pyramid",
    icon: "icon-box",
})
export class Pyramid extends RectCommandBase {
    protected override getSteps(): IStep[] {
        let steps = super.getSteps();
        let third = new LengthAtAxisStep("operate.pickNextPoint", this.getHeightStepData);
        return [...steps, third];
    }

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        return {
            point: this.stepDatas[1].point!,
            direction: this.stepDatas[0].view.workplane.normal,
            preview: this.previewPyramid,
        };
    };

    private readonly previewPyramid = (end: XYZ | undefined) => {
        const point1 = this.stepDatas[0].point!;
        const point2 = this.stepDatas[1].point!;
        if (!end) {
            return this.previewRect(point2);
        }
        const p1 = this.previewPoint(point1);
        const p2 = this.previewPoint(point2);
        const data = this.tmpPoint2RectData(end);

        const aaa = this.application.shapeFactory.pyramid(
            data.plane.origin,
            data.dx,
            data.dy,
            this.getHeight(data.plane, end),
        ).value.mesh.edges!;

        return [p1, p2, aaa];
    };

    protected override geometryNode(): GeometryNode {
        const rect = this.tmpPoint2RectData(this.stepDatas[1].point!);
        const dz = this.getHeight(rect.plane, this.stepDatas[2].point!);
        return new PyramidNode(this.document, rect.plane, rect.dx, rect.dy, dz);
    }

    private getHeight(plane: Plane, point: XYZ) {
        return point.sub(this.stepDatas[1].point!).dot(plane.normal);
    }
}
