// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryModel, IEdge, ShapeType, command } from "chili-core";
import { SweepBody } from "../../bodys";
import { IStep } from "../../step";
import { SelectStep } from "../../step/selectStep";
import { CreateCommand } from "./createCommand";

let count = 1;

@command({
    name: "convert.sweep",
    display: "command.sweep",
    icon: "icon-circle",
})
export class Sweep extends CreateCommand {
    protected override create(): GeometryModel {
        let shape = this.stepDatas[0].shapes[0].shape;
        let edge = this.stepDatas[1].shapes[0].shape as IEdge;
        let wire = this.application.shapeFactory.wire(edge).getValue()!;
        let body = new SweepBody(this.document, shape, wire);
        return new GeometryModel(this.document, `Sweep ${count++}`, body);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectStep(ShapeType.Shape, "prompt.select.shape", false),
            new SelectStep(ShapeType.Edge, "prompt.select.edges", false),
        ];
    }
}
