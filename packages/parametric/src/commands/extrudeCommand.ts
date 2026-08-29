// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    MultistepCommand,
    Precision,
    Transaction,
} from "@chili3d/core";
import { sketchFaces } from "../features/profileBuilder";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";

@command({ key: "feature.extrude", icon: "icon-prism" })
export class ExtrudeFeatureCommand extends MultistepCommand {
    private get sketch(): SketchNode {
        return this.stepDatas[0].nodes![0] as unknown as SketchNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.sketch", {
                filter: { allow: (node: INode) => node instanceof SketchNode },
            }),
            new LengthAtAxisStep("prompt.pickNextPoint", this.getLengthStepData, true),
        ];
    }

    private readonly getLengthStepData = (): LengthAtAxisSnapData => {
        const { origin, normal } = this.sketch.plane;
        return {
            point: origin,
            direction: normal,
            preview: (point) => {
                if (point === undefined) return [];
                const dist = point.sub(origin).dot(normal);
                if (Math.abs(dist) < Precision.Float) return [];
                const faces = sketchFaces(this.sketch);
                if (!faces.isOk) return [];
                return faces.value.map((face) => this.meshCreatedShape("prism", face, normal.multiply(dist)));
            },
        };
    };

    protected override executeMainTask(): void {
        const { origin, normal } = this.sketch.plane;
        const length = this.stepDatas[1].point!.sub(origin).dot(normal);
        const node = new ParametricBodyNode({
            document: this.document,
            features: [{ id: Id.generate(), type: "extrude", sketchId: this.sketch.id, length }],
        });
        Transaction.execute(this.document, "excute feature.extrude", () => {
            this.document.modelManager.addNode(node);
            this.document.visual.update();
        });
    }
}
