// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    GroupNode,
    IShape,
    ShapeNode,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
import { IStep } from "../../step";
import { GetOrSelectShapeNodeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "modify.explode",
    display: "command.explode",
    icon: "icon-explode",
})
export class Explode extends MultistepCommand {
    protected override executeMainTask() {
        this.document.selection.clearSelection();

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].nodes?.forEach((x) => {
                const shapeNode = x as ShapeNode;

                let subShapes = shapeNode.shape.value.iterShape();
                if (subShapes.length === 1) {
                    const subShapeNode = new EditableShapeNode(
                        this.document,
                        x.name,
                        subShapes[0],
                        shapeNode.materialId,
                    );
                    subShapeNode.transform = shapeNode.transform;
                    x.parent?.insertAfter(shapeNode.previousSibling, subShapeNode);
                } else {
                    this.groupShapes(shapeNode, subShapes);
                }

                shapeNode.parent?.remove(shapeNode);
            });
        });

        this.document.visual.update();
    }

    private groupShapes(node: ShapeNode, subShapes: IShape[]) {
        const folder = new GroupNode(this.document, node.name);
        folder.transform = node.transform;
        node.parent?.insertAfter(node.previousSibling, folder);

        let i = 1;
        for (const subShape of subShapes) {
            const name = `${ShapeType.stringValue(subShape.shapeType)} ${i++}`;
            let subShapeNode = new EditableShapeNode(this.document, name, subShape);
            folder.add(subShapeNode);
        }
    }

    protected override getSteps(): IStep[] {
        return [new GetOrSelectShapeNodeStep("prompt.select.shape", { multiple: true })];
    }
}
