// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    type IFace,
    MultistepCommand,
    PubSub,
    retargetInstanceSources,
    SELECTED_FACE_STATE,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";

@command({
    key: "modify.removeFeature",
    icon: "icon-removeFeature",
})
export class RemoveFaceCommand extends MultistepCommand {
    protected override executeMainTask() {
        const faces = this.stepDatas.at(-1)!.shapes.map((x) => x.shape as IFace);
        if (faces.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select at least one face to remove");
            return;
        }

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
            const filetShape = shapeFactory.removeFeature(node.shape.value, faces);
            if (!filetShape.isOk) {
                PubSub.default.pub("displayError", filetShape.error);
                return;
            }

            const model = new EditableShapeNode({
                document: this.document,
                name: node.name,
                shape: filetShape,
                materialId: node.materialId,
            });
            model.transform = node.transform;

            this.document.modelManager.addNode(model);
            retargetInstanceSources(this.document, node.id, model.id);
            node.parent?.remove(node);
            this.document.visual.update();
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                shapeFilter: {
                    allow: (shape) => {
                        return (
                            shape.shapeType === ShapeTypes.solid ||
                            shape.shapeType === ShapeTypes.compound ||
                            shape.shapeType === ShapeTypes.compoundSolid
                        );
                    },
                },
                selectedState: VisualStates.faceTransparent,
            }),
            new SelectShapeStep(ShapeTypes.face, "prompt.select.faces", {
                multiple: true,
                // Translucent fill with the boundary outlined: an opaque selection hides the
                // faces behind the ones already picked.
                selectedState: SELECTED_FACE_STATE,
                // The removal heals one body; a face picked on another would be handed to the
                // kernel against the first body's shape.
                nodeFilter: {
                    allow: (node) => node === this.stepDatas.at(0)?.shapes.at(0)?.owner.node,
                },
                beforeSelection: () => this.addFirstSelectedState(VisualStates.faceTransparent),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.faceTransparent),
            }),
        ];
    }
}
