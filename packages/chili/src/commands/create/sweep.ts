// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryEntity, IWire, ParameterGeometryEntity, ShapeType, command } from "chili-core";
import { SweepBody } from "../../bodys";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.sweep",
    display: "command.sweep",
    icon: "icon-sweep",
})
export class Sweep extends CreateCommand {
    protected override geometryEntity(): GeometryEntity {
        let shape = this.stepDatas[0].shapes[0].shape;
        let path = this.stepDatas[1].shapes[0].shape;
        let body = new SweepBody(this.document, shape, path as IWire);
        return new ParameterGeometryEntity(this.document, body);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                ShapeType.Edge | ShapeType.Wire | ShapeType.Face,
                "prompt.select.shape",
                false,
            ),
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire, "prompt.select.edges", false),
        ];
    }
}
