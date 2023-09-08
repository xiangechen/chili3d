// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncController,
    GeometryModel,
    IFace,
    IShape,
    Precision,
    ShapeType,
    XYZ,
    command,
} from "chili-core";
import { Selection } from "../../selection";
import { SnapLengthAtAxisData } from "../../snap";
import { IStep, LengthAtAxisStep } from "../../step";
import { CreateCommand } from "./createCommand";
import { PrismBody } from "../../bodys";

let count = 1;

@command({
    name: "convert.prism",
    display: "command.prism",
    icon: "icon-circle",
})
export class Prism extends CreateCommand {
    #shapes: IShape[] | undefined;

    protected override create(): GeometryModel {
        let shape = this.#shapes?.at(0) as IFace; // todo assert
        let [point, normal] = shape.normal(0, 0);
        let dist = this.stepDatas[0].point.sub(point).dot(normal);
        let body = new PrismBody(this.document, shape, dist);
        return new GeometryModel(this.document, `prism${count++}`, body);
    }

    protected override getSteps(): IStep[] {
        return [new LengthAtAxisStep("operate.pickNextPoint", this.getLengthStepData)];
    }

    private getLengthStepData = (): SnapLengthAtAxisData => {
        let shape = this.#shapes?.at(0) as IFace; // todo assert
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

    protected override async beforeExecute(): Promise<boolean> {
        if (!(await super.beforeExecute())) return false;
        let controller: AsyncController = new AsyncController();
        this.#shapes = await Selection.pickShape(
            this.document,
            ShapeType.Face,
            "prompt.select.faces",
            controller,
            false,
            false,
        );
        return !this.restarting && this.#shapes.length > 0;
    }
}
