// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, ShapeNode, ShapeType, Transaction, VisualState, command } from "chili-core";
import { SelectShapeStep } from "../../step/selectStep";
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

            const model = new EditableShapeNode(this.document, node.name, shape, node.materialId);
            model.transform = node.transform;

            node.parent?.insertAfter(node.previousSibling, model);
            node.parent?.remove(node);
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                shapeFilter: {
                    allow: (shape) => {
                        return shape.shapeType !== ShapeType.Vertex && shape.shapeType !== ShapeType.Edge;
                    },
                },
                selectedState: VisualState.faceTransparent,
            }),
            new SelectShapeStep(ShapeType.Edge | ShapeType.Face, "prompt.select.shape", {
                multiple: true,
                keepSelection: true,
            }),
        ];
    }
}
