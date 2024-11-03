// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EditableShapeNode,
    GeometryNode,
    IEdge,
    IVisualGeometry,
    Result,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
import { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "modify.split",
    display: "command.split",
    icon: "icon-split",
})
export class Split extends MultistepCommand {
    private splitedShape() {
        let shape1 = this.stepDatas[0].shapes[0].shape;
        let edges = this.stepDatas[1].shapes.map((x) => x.shape) as IEdge[];
        return shape1.split(edges);
    }

    protected override executeMainTask() {
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let old = this.document.visual.context.getNode(this.stepDatas[0].shapes[0].owner)!;
            let shape = this.splitedShape();
            if (old instanceof EditableShapeNode) {
                old.shape = Result.ok(shape);
            } else if (old instanceof GeometryNode) {
                let model = new EditableShapeNode(this.document, old.name, shape);
                model.transform = old.transform;
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
            let model = this.document.visual.context.getNode(x);
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
