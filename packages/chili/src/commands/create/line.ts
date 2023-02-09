// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Container, Id, IDocument, IView, Model, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

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
    create(document: IDocument): Model {
        let body = new LineBody(this.stepDatas[0].point, this.stepDatas[1].point);
        return new Model(`Line ${document.modelCount + 1}`, Id.new(), body);
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

    private linePreview = (view: IView, point: XYZ) => {
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory!.line(this.stepDatas[0].point, point).value;
    };
}
