// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { EditableGeometryEntity, GeometryEntity, IEdge, ShapeType, command } from "chili-core";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    name: "modify.split",
    display: "command.split",
    icon: "icon-split",
})
export class Split extends CreateCommand {
    protected override geometryEntity(): GeometryEntity {
        let shape1 = this.stepDatas[0].shapes[0].shape;
        let edges = this.stepDatas[1].shapes.map((x) => x.shape) as IEdge[];
        let shapes = shape1.split(edges);
        return new EditableGeometryEntity(this.document, shapes);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", false),
            new SelectShapeStep(ShapeType.Edge, "prompt.select.shape", true),
        ];
    }
}
