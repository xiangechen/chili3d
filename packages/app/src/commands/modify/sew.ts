// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    type IStep,
    PubSub,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.sew",
    icon: "icon-sew",
})
export class Sew extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, "sew", () => {
            const shape1 = this.transformdFirstShape(this.stepDatas[0]);
            const shape2 = this.transformdFirstShape(this.stepDatas[1]);

            const result = this.application.shapeFactory.sewing(shape1, shape2);
            if (!result.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", result.error);
                return;
            }

            const node = new EditableShapeNode({
                document: this.document,
                name: "sewed",
                shape: result.value,
            });
            this.document.modelManager.rootNode.add(node);

            this.stepDatas[0].nodes?.[0]?.parent?.remove(this.stepDatas[0].nodes![0]);
            this.stepDatas[1].nodes?.[0]?.parent?.remove(this.stepDatas[1].nodes![0]);

            this.document.visual.update();
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                nodeFilter: { allow: (node) => node instanceof ShapeNode },
                selectedState: VisualStates.faceTransparent,
            }),
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                nodeFilter: {
                    allow: (node) => {
                        if (!(node instanceof ShapeNode)) {
                            return false;
                        }

                        return !this.stepDatas[0].nodes
                            ?.map((x) => (x as ShapeNode).shape.value)
                            .includes(node.shape.value);
                    },
                },
                keepSelection: true,
                selectedState: VisualStates.faceTransparent,
            }),
        ];
    }
}
