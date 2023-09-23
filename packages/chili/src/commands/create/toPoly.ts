// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, GeometryModel, IEdge, ShapeType, VisualShapeData, command } from "chili-core";
import { WireBody } from "../../bodys/wire";
import { Selection } from "../../selection";
import { IStep, SelectModelStep } from "../../step";
import { CreateFaceableCommand } from "./createCommand";

let count = 1;

@command({
    name: "convert.toPolygon",
    display: "command.toPoly",
    icon: "icon-toPoly",
})
export class ConverterToPoly extends CreateFaceableCommand {
    protected override create(): GeometryModel {
        let models = this.stepDatas[0].models!;
        let edges = models.map((x) => x.shape()) as IEdge[];
        let wireBody = new WireBody(this.document, edges);
        wireBody.isFace = this.isFace;
        models.forEach((x) => x.parent?.remove(x));
        return new GeometryModel(this.document, `Wire ${count++}`, wireBody);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectModelStep("prompt.select.edges", true, {
                allow: (shape) => {
                    return shape.shapeType === ShapeType.Edge;
                },
            }),
        ];
    }
}
