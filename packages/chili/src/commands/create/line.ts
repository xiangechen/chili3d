// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, IDocument, XYZ, command } from "chili-core";
import { Application } from "chili-core/src/application";

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
    private static count: number = 1;

    create(document: IDocument): GeometryModel {
        let body = new LineBody(document, this.stepDatas[0].point, this.stepDatas[1].point);
        return new GeometryModel(document, `Line ${Line.count++}`, body);
    }

    override afterExcute(document: IDocument): Promise<void> {
        this.stepDatas[0] = this.stepDatas[1];
        this.stepDatas.length = 1;
        return this.excuteFrom(document, 1);
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
        return Application.instance.shapeFactory.line(this.stepDatas[0].point, point).value?.mesh().edges;
    };
}
