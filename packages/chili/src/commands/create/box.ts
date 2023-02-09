// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Container, Id, IDocument, IView, Model, Plane, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { BoxBody } from "../../bodys";
import { SnapLengthAtAxisData } from "../../snap/snapLengthEventHandler";
import { LengthAtAxisStep } from "../step";
import { IStep } from "../step/step";
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
            point: this.snapedDatas[1].point,
            direction: this.snapedDatas[0].view.workplane.normal,
            preview: this.previewBox,
        };
    };

    private previewBox = (_view: IView, end: XYZ) => {
        let data = this.getRectData();
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory?.box(data.plane, data.dx, data.dy, this.getHeight(data.plane, end)).value;
    };

    protected create(document: IDocument): Model {
        let rect = this.getRectData();
        let body = new BoxBody(rect.plane, rect.dx, rect.dy, this.getHeight(rect.plane, this.snapedDatas[2].point));
        return new Model(`Box ${document.modelCount + 1}`, Id.new(), body);
    }

    private getHeight(plane: Plane, point: XYZ): number {
        return point.sub(this.snapedDatas[1].point).dot(plane.normal);
    }
}
