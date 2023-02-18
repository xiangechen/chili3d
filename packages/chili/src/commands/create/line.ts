// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Container, IDocument, GeometryModel, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Application } from "../../application";

import { LineBody } from "../../bodys";
import { Dimension, SnapPointData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";

@command({
    name: "Line",
    display: "command.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    create(document: IDocument): GeometryModel {
        let body = new LineBody(this.stepDatas[0].point, this.stepDatas[1].point);
        return new GeometryModel(`Line ${document.models.count + 1}`, body);
    }

    override afterExcute(document: IDocument): boolean {
        this.stepDatas[0] = this.stepDatas[1];
        this.stepDatas.length = 1;
        this.excuteFromStep(document, 1);
        return true;
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private getSecondPointData = (): SnapPointData => {
        return {
            refPoint: this.stepDatas[0].point,
            dimension: Dimension.D1D2D3,
            preview: this.linePreview,
        };
    };

    private linePreview = (point: XYZ) => {
        return Application.instance.shapeFactory.line(this.stepDatas[0].point, point).value;
    };
}
