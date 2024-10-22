// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, Plane, XYZ, command } from "chili-core";
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
        return {
            point: this.stepDatas[1].point!,
            direction: this.stepDatas[0].view.workplane.normal,
            preview: this.previewBox,
        };
    };

    private readonly previewBox = (end: XYZ | undefined) => {
        if (!end) {
            return this.previewRect(this.stepDatas[1].point);
        }
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        let p2 = this.previewPoint(this.stepDatas[1].point!);
        let data = this.getRectData(end);
        return [
            p1,
            p2,
            this.application.shapeFactory.box(data.plane, data.dx, data.dy, this.getHeight(data.plane, end))
                .value.mesh.edges!,
        ];
    };

    protected override geometryNode(): GeometryNode {
        let rect = this.getRectData(this.stepDatas[1].point!);
        let dz = this.getHeight(rect.plane, this.stepDatas[2].point!);
        return new BoxNode(this.document, rect.plane, rect.dx, rect.dy, dz);
    }

    private getHeight(plane: Plane, point: XYZ): number {
        return point.sub(this.stepDatas[1].point!).dot(plane.normal);
    }
}
