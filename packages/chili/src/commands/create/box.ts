// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, Precision, XYZ, command } from "chili-core";
import { BoxNode } from "../../bodys";
import { LengthAtAxisSnapData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { RectCommandBase } from "./rect";

@command({
    name: "create.box",
    display: "command.box",
    icon: "icon-box",
})
export class Box extends RectCommandBase {
    protected override getSteps(): IStep[] {
        let steps = super.getSteps();
        let third = new LengthAtAxisStep("operate.pickNextPoint", this.getHeightStepData);
        return [...steps, third];
    }

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        const plane = this.stepDatas[1].plane;
        if (plane === undefined) {
            throw new Error("plane is undefined, please report bug");
        }
        return {
            point: this.stepDatas[1].point!,
            direction: plane.normal,
            preview: this.previewBox,
        };
    };

    private readonly previewBox = (end: XYZ | undefined) => {
        const point1 = this.stepDatas[0].point!;
        const point2 = this.stepDatas[1].point!;
        if (!end) {
            return this.previewRect(point2);
        }
        const p1 = this.previewPoint(point1);
        const p2 = this.previewPoint(point2);
        const data = this.point2RectData();
        return [
            p1,
            p2,
            this.application.shapeFactory.box(data.plane, data.dx, data.dy, this.getHeight(data.plane, end))
                .value.mesh.edges!,
        ];
    };

    protected override geometryNode(): GeometryNode {
        const rect = this.point2RectData();
        const dz = this.getHeight(rect.plane, this.stepDatas[2].point!);
        return new BoxNode(this.document, rect.plane, rect.dx, rect.dy, dz);
    }

    private getHeight(plane: Plane, point: XYZ): number {
        const h = point.sub(this.stepDatas[1].point!).dot(plane.normal);
        if (Math.abs(h) < Precision.Distance) {
            return h < 0 ? -0.00001 : 0.00001;
        }
        return h;
    }
}
