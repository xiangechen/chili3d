// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ComponentNode,
    EditableShapeNode,
    GroupNode,
    IShape,
    MultiShapeNode,
    ShapeNode,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
import { IStep } from "../../step";
import { GetOrSelectNodeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.explode",
    icon: "icon-explode",
})
export class Explode extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.shape", { multiple: true })];
    }

    protected override executeMainTask() {
        this.document.selection.clearSelection();

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].nodes?.forEach((x) => {
                if (x instanceof ShapeNode) {
                    this.explodeShapeNode(x);
                } else if (x instanceof ComponentNode) {
                    this.explodeComponentNode(x);
                } else if (x instanceof MultiShapeNode) {
                    this.explodeMultiShapeNode(x);
                }
            });
        });

        this.document.visual.update();
    }

    private explodeShapeNode(x: ShapeNode) {
        let subShapes = x.shape.value.iterShape();
        if (subShapes.length === 1) {
            const subShapeNode = new EditableShapeNode(this.document, x.name, subShapes[0], x.materialId);
            subShapeNode.transform = x.transform;
            x.parent?.insertAfter(x.previousSibling, subShapeNode);
        } else {
            this.groupShapes(x, subShapes);
        }

        x.parent?.remove(x);
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

    private explodeComponentNode(x: ComponentNode) {
        for (const node of x.component.nodes) {
            const newNode = node.clone();
            newNode.transform = node.transform.multiply(x.transform);
            x.parent?.insertAfter(x.previousSibling, newNode);
        }

        x.parent?.remove(x);
    }

    private explodeMultiShapeNode(x: MultiShapeNode) {
        for (const shape of x.shapes) {
            const node = new EditableShapeNode(this.document, x.name, shape.transformed(x.transform));
            x.parent?.insertAfter(x.previousSibling, node);
        }

        x.parent?.remove(x);
        x.shapes.forEach((x) => x.dispose());
    }
}
