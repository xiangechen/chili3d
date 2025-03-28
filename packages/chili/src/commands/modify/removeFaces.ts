// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    EditableShapeNode,
    IFace,
    ShapeNode,
    ShapeType,
    Transaction,
    VisualState,
    command,
} from "chili-core";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "modify.removeFaces",
    display: "command.removeFaces",
    icon: "icon-removeFaces",
})
export class RemoveFaceCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.geometryNode as ShapeNode;
            const faces = this.stepDatas.at(-1)!.shapes.map((x) => x.shape as IFace);
            const filetShape = this.document.application.shapeFactory.removeFaces(node.shape.value, faces);

            const model = new EditableShapeNode(this.document, node.name, filetShape, node.materialId);
            model.transform = node.transform;

            this.document.addNode(model);
            node.parent?.remove(node);
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                filter: {
                    allow: (shape) => {
                        return (
                            shape.shapeType === ShapeType.Solid ||
                            shape.shapeType === ShapeType.Compound ||
                            shape.shapeType === ShapeType.CompoundSolid
                        );
                    },
                },
                selectedState: VisualState.faceTransparent,
            }),
            new SelectShapeStep(ShapeType.Face, "prompt.select.faces", { multiple: true }),
        ];
    }
}
