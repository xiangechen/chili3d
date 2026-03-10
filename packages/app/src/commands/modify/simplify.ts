// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    property,
    SelectShapeStep,
    type ShapeNode,
    ShapeType,
    Transaction,
    VisualState,
} from "@chili3d/core";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.simplifyShape",
    icon: "icon-simplify",
})
export class SimplifyShapeCommand extends MultistepCommand {
    @property("common.removeEdges")
    get removeEdges() {
        return this.getPrivateValue("removeEdges", true);
    }

    set removeEdges(value: boolean) {
        this.setProperty("removeEdges", value);
    }

    @property("common.removeFaces")
    get removeFaces() {
        return this.getPrivateValue("removeFaces", true);
    }

    set removeFaces(value: boolean) {
        this.setProperty("removeFaces", value);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `execute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
            const shape = this.stepDatas[0].shapes[0].shape;

            const simplifiedShape = this.document.application.shapeFactory.simplifyShape(
                shape,
                this.removeEdges,
                this.removeFaces,
            );

            if (!simplifiedShape.isOk) {
                throw simplifiedShape.error;
            }

            const model = new EditableShapeNode(
                this.document,
                node.name + "_simplified",
                simplifiedShape.value,
                node.materialId,
            );
            model.transform = node.transform;
            (node.parent ?? this.document.modelManager.rootNode).add(model);
            node.parent?.remove(node);
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                shapeFilter: {
                    allow: (shape) => {
                        return (
                            shape.shapeType === ShapeType.Solid ||
                            shape.shapeType === ShapeType.Compound ||
                            shape.shapeType === ShapeType.CompoundSolid ||
                            shape.shapeType === ShapeType.Shell ||
                            shape.shapeType === ShapeType.Face
                        );
                    },
                },
                selectedState: VisualState.faceTransparent,
            }),
        ];
    }
}
