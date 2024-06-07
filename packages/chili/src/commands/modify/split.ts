// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EditableGeometryEntity,
    GeometryEntity,
    GeometryModel,
    IEdge,
    IVisualGeometry,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
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

    protected override executeMainTask() {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let geometry = this.geometryEntity() as EditableGeometryEntity;
            let old = this.document.visual.context.getModel(this.stepDatas[0].shapes[0].owner)!;
            if (old instanceof EditableGeometryEntity) {
                old.replaceShape(geometry.shape.unwrap());
            } else {
                let model = new GeometryModel(this.document, old.name, geometry);
                model.geometry.matrix = old.geometry.matrix;
                this.removeModels(
                    this.stepDatas[0].shapes[0].owner,
                    ...this.stepDatas[1].shapes.map((x) => x.owner),
                );
                this.document.addNode(model);
            }
            this.document.visual.update();
        });
    }

    private removeModels(...shapes: IVisualGeometry[]) {
        shapes.forEach((x) => {
            let model = this.document.visual.context.getModel(x);
            model?.parent?.remove(model);
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", false),
            new SelectShapeStep(ShapeType.Wire | ShapeType.Edge, "prompt.select.shape", true),
        ];
    }
}
