// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    PubSub,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    ShapeTypeUtils,
    Transaction,
} from "@chili3d/core";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.copyShape",
    icon: "icon-subShape",
})
export class CopySubShapeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].shapes.forEach((x) => {
                const subShape = x.shape.clone();
                const model = new EditableShapeNode({
                    document: this.document,
                    name: ShapeTypeUtils.stringValue(subShape.shapeType),
                    shape: subShape,
                });

                const node = x.owner.node;
                model.transform = node.transform;
                node.parent?.insertAfter(node, model);
            });
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.face) as ShapeType, "prompt.select.shape", {
                multiple: true,
            }),
        ];
    }
}
