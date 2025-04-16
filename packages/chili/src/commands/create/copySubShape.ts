// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, ShapeType, Transaction, command } from "chili-core";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "create.copySubShape",
    display: "command.copySubShape",
    icon: "icon-subShape",
})
export class CopySubShapeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const subShapes = this.stepDatas.at(0)!.shapes.map((x) => x.shape);
            const model = new EditableShapeNode(
                this.document,
                ShapeType.stringValue(subShapes[0].shapeType),
                subShapes[0],
            );

            const node = this.stepDatas[0].shapes[0].owner.geometryNode;
            node.parent?.insertAfter(node, model);
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [new SelectShapeStep(ShapeType.Edge | ShapeType.Face, "prompt.select.shape")];
    }
}
