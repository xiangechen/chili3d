// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    type IStep,
    instanceSourcesInUse,
    isReferenceGeometryNode,
    MultistepCommand,
    PubSub,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { repairShape } from "./repair";

@command({
    key: "modify.sew",
    icon: "icon-sew",
})
export class Sew extends MultistepCommand {
    protected override executeMainTask() {
        // One sewed node replaces every input, so there is no successor to retarget.
        const removed = this.stepDatas[0].nodes ?? [];
        if (instanceSourcesInUse(this.document, removed).size > 0) {
            PubSub.default.pub("showToast", "toast.instance.sourceInUse");
            return;
        }
        Transaction.execute(this.document, "sew", () => {
            const shapes = this.transformdShapes(this.stepDatas[0]);
            const result = shapeFactory.sewing(shapes);
            if (!result.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", result.error);
                return;
            }
            const repaired = repairShape(result.value, 1e-7);
            if (repaired !== result.value) result.value.dispose();

            const node = new EditableShapeNode({
                document: this.document,
                name: "sewed",
                shape: repaired,
            });
            this.document.modelManager.rootNode.add(node);

            this.stepDatas[0].nodes?.forEach((x) => x.parent?.remove(x));

            this.document.visual.update();
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                nodeFilter: { allow: (node) => node instanceof ShapeNode && !isReferenceGeometryNode(node) },
                selectedState: VisualStates.faceTransparent,
                multiple: true,
            }),
        ];
    }
}
