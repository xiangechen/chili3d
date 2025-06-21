// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    ISubEdgeShape,
    Property,
    ShapeNode,
    ShapeType,
    Transaction,
    VisualState,
    command,
} from "chili-core";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.chamfer",
    icon: "icon-chamfer",
})
export class ChamferCommand extends MultistepCommand {
    @Property.define("common.length")
    get length() {
        return this.getPrivateValue("length", 10);
    }

    set length(value: number) {
        this.setProperty("length", value);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
            const edges = this.stepDatas.at(-1)!.shapes.map((x) => (x.shape as ISubEdgeShape).index);
            const filetShape = this.document.application.shapeFactory.chamfer(
                node.shape.value,
                edges,
                this.length,
            );

            const model = new EditableShapeNode(this.document, node.name, filetShape, node.materialId);
            model.transform = node.transform;

            (node.parent ?? this.document.rootNode).add(model);
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
                            shape.shapeType === ShapeType.CompoundSolid
                        );
                    },
                },
                selectedState: VisualState.faceTransparent,
            }),
            new SelectShapeStep(ShapeType.Edge, "prompt.select.edges", {
                multiple: true,
                keepSelection: true,
            }),
        ];
    }
}
