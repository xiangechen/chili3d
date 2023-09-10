// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncController,
    GeometryModel,
    IFace,
    Precision,
    ShapeType,
    VisualShapeData,
    command,
} from "chili-core";
import { PrismBody } from "../../bodys";
import { Selection } from "../../selection";
import { SnapLengthAtAxisData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { CreateCommand } from "./createCommand";
import { SelectStep } from "../../step/selectStep";

let count = 1;

@command({
    name: "convert.prism",
    display: "command.prism",
    icon: "icon-circle",
})
export class Prism extends CreateCommand {
    protected override create(): GeometryModel {
        let shape = this.stepDatas[0].shapes[0].shape as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        let dist = this.stepDatas[1].point!.sub(point).dot(normal);
        let body = new PrismBody(this.document, shape, dist);
        return new GeometryModel(this.document, `prism${count++}`, body);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectStep(ShapeType.Face, "prompt.select.faces", false),
            new LengthAtAxisStep("operate.pickNextPoint", this.getLengthStepData),
        ];
    }

    private getLengthStepData = (): SnapLengthAtAxisData => {
        let shape = this.stepDatas[0].shapes[0].shape as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        return {
            point,
            direction: normal,
            preview: (p) => {
                let dist = p.sub(point).dot(normal);
                if (Math.abs(dist) < Precision.Number) return [];
                let vec = normal.multiply(dist);
                return [this.application.shapeFactory.prism(shape, vec).unwrap().mesh.edges!];
            },
        };
    };
}
