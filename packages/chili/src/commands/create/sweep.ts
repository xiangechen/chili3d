// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, IWire, ShapeType, command } from "chili-core";
import { SweepedNode } from "../../bodys";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "convert.sweep",
    display: "command.sweep",
    icon: "icon-sweep",
})
export class Sweep extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        const shape = this.stepDatas[0].shapes[0].shape;
        const path = this.stepDatas[1].shapes[0].shape as IWire;
        return new SweepedNode(this.document, shape, path);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire | ShapeType.Face, "prompt.select.shape"),
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire, "prompt.select.edges", {
                keepSelection: true,
            }),
        ];
    }
}
