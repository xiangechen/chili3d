// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Id, IDocument, Model, Plane } from "chili-core";
import { RectBody } from "../../bodys";
import { PointStep } from "../../step/pointStep";
import { RectData, RectStep, RectStepData } from "../../step/rectStep";
import { IStep } from "../../step/step";
import { CreateCommand } from "./createCommand";

export abstract class RectCommandBase extends CreateCommand {
    protected getSteps(): IStep[] {
        let first = new PointStep("operate.pickFistPoint");
        let second = new RectStep("operate.pickNextPoint", this.getRectStepData);
        return [first, second];
    }

    private getRectStepData = (): RectStepData => {
        let firstPoint = this.stepDatas[0].point;
        return {
            firstPoint,
            plane: this.stepDatas[0].view.workplane.copyTo(firstPoint),
        };
    };

    protected getRectData(): RectData {
        let [p1, p2] = [this.stepDatas[0].point, this.stepDatas[1].point];
        return RectData.get(this.stepDatas[0].view.workplane, p1, p2);
    }
}

@command({
    name: "Rect",
    display: "command.rect",
    icon: "icon-rect",
})
export class Rect extends RectCommandBase {
    protected create(document: IDocument): Model {
        let rect = this.getRectData();
        let body = new RectBody(rect.plane, rect.dx, rect.dy);
        return new Model(`Rect ${document.modelCount + 1}`, Id.new(), body);
    }

    constructor() {
        super();
    }
}
