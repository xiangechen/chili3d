// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.removeShapes",
    icon: "icon-removeSubShape",
})
export class RemoveSubShapesCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
            const subShapes = this.stepDatas.at(-1)!.shapes.map((x) => x.shape);
            const shape = this.document.application.shapeFactory.removeSubShape(node.shape.value, subShapes);

            const model = new EditableShapeNode({
                document: this.document,
                name: node.name,
                shape,
                materialId: node.materialId,
            });
            model.transform = node.transform;

            node.parent?.insertAfter(node.previousSibling, model);
            node.parent?.remove(node);
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                shapeFilter: {
                    allow: (shape) => {
                        return shape.shapeType !== ShapeTypes.vertex && shape.shapeType !== ShapeTypes.edge;
                    },
                },
                selectedState: VisualStates.faceTransparent,
            }),
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.face) as ShapeType, "prompt.select.shape", {
                multiple: true,
                keepSelection: true,
            }),
        ];
    }
}
