// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Container, IDocument, GeometryModel, Plane, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Application } from "../../application";

import { BoxBody } from "../../bodys";
import { SnapLengthAtAxisData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { RectCommandBase } from "./rect";

@command({
    name: "Box",
    display: "command.box",
    icon: "icon-box",
})
export class Box extends RectCommandBase {
    protected override getSteps(): IStep[] {
        let steps = super.getSteps();
        let third = new LengthAtAxisStep("operate.pickNextPoint", this.getHeightStepData);
        return [...steps, third];
    }

    private getHeightStepData = (): SnapLengthAtAxisData => {
        return {
            point: this.stepDatas[1].point,
            direction: this.stepDatas[0].view.workplane.normal,
            preview: this.previewBox,
        };
    };

    private previewBox = (end: XYZ) => {
        let data = this.getRectData(end);
        return Application.instance.shapeFactory.box(
            data.plane,
            data.dx,
            data.dy,
            this.getHeight(data.plane, end)
        ).value;
    };

    protected create(document: IDocument): GeometryModel {
        let rect = this.getRectData(this.stepDatas[1].point);
        let dz = this.getHeight(rect.plane, this.stepDatas[2].point);
        let body = new BoxBody(document, rect.plane, rect.dx, rect.dy, dz);
        return GeometryModel.create(document, `Box ${document.nodes.size() + 1}`, body);
    }

    private getHeight(plane: Plane, point: XYZ): number {
        return point.sub(this.stepDatas[1].point).dot(plane.normal);
    }
}
