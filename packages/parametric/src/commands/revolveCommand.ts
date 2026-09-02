// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    MultistepCommand,
    Transaction,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { promptNumber } from "./promptDialog";

@command({ key: "feature.revolve", icon: "icon-revolve" })
export class RevolveFeatureCommand extends MultistepCommand {
    private get sketch(): SketchNode {
        return this.stepDatas[0].nodes![0] as unknown as SketchNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.sketch", {
                filter: { allow: (node: INode) => node instanceof SketchNode },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const sketch = this.sketch;
        const { origin, yvec } = sketch.plane;

        promptNumber("dialog.title.enterValue", 360, (angle) => {
            const node = new ParametricBodyNode({
                document: this.document,
                features: [
                    {
                        id: Id.generate(),
                        type: "revolve",
                        sketchId: sketch.id,
                        axis: {
                            point: { x: origin.x, y: origin.y, z: origin.z },
                            direction: { x: yvec.x, y: yvec.y, z: yvec.z },
                        },
                        angle,
                    },
                ],
            });
            Transaction.execute(this.document, "excute feature.revolve", () => {
                this.document.modelManager.addNode(node);
                // The sketch is consumed by the feature; hide it. Same transaction, so
                // undo restores the visibility together with the body.
                sketch.visible = false;
                this.document.visual.update();
            });
        });
    }
}
