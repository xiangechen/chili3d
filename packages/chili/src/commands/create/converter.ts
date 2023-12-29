// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryModel, IEdge, ShapeType, command } from "chili-core";
import { WireBody } from "../../bodys/wire";
import { IStep, SelectModelStep } from "../../step";
import { CreateCommand } from "./createCommand";
import { FaceBody } from "../../bodys/face";

let count = 1;

@command({
    name: "convert.toWire",
    display: "command.toWire",
    icon: "icon-toPoly",
})
export class ConvertToWire extends CreateCommand {
    protected override create(): GeometryModel {
        let models = this.stepDatas[0].models!;
        let edges = models.map((x) => x.shape()) as IEdge[];
        let wireBody = new WireBody(this.document, edges);
        models.forEach((x) => x.parent?.remove(x));
        return new GeometryModel(this.document, `Wire ${count++}`, wireBody);
    }

    protected override shouldClearSelectedBeforeExcute() {
        return false;
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

@command({
    name: "convert.toFace",
    display: "command.toFace",
    icon: "icon-toFace",
})
export class ConvertToFace extends CreateCommand {
    protected override create(): GeometryModel {
        let models = this.stepDatas[0].models!;
        let edges = models.map((x) => x.shape()) as IEdge[];
        let wireBody = new FaceBody(this.document, edges);
        models.forEach((x) => x.parent?.remove(x));
        return new GeometryModel(this.document, `Face ${count++}`, wireBody);
    }

    protected override shouldClearSelectedBeforeExcute() {
        return false;
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectModelStep("prompt.select.edges", true, {
                allow: (shape) => {
                    return shape.shapeType === ShapeType.Edge || shape.shapeType === ShapeType.Wire;
                },
            }),
        ];
    }
}
