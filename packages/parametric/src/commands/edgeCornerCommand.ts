// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type IEdge,
    type INode,
    type IStep,
    MultistepCommand,
    SelectShapeStep,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type { ChamferFeatureData, FilletFeatureData } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";
import { promptNumber } from "./promptDialog";

/** Shared flow for fillet/chamfer: pick a parametric body, pick its edges, enter the value. */
abstract class EdgeCornerFeatureCommand extends MultistepCommand {
    protected abstract readonly featureType: "fillet" | "chamfer";
    protected abstract readonly defaultValue: number;

    private get body(): ParametricBodyNode {
        return this.stepDatas[0].nodes![0] as unknown as ParametricBodyNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.edges", {
                multiple: true,
                nodeFilter: {
                    allow: (node: INode) => this.stepDatas.length > 0 && node === this.stepDatas[0].nodes![0],
                },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const edges = this.stepDatas[1].shapes.map((data) =>
            captureEdgeRef(data.shape as unknown as IEdge, this.body.edgeIdAt(data.indexes[0])),
        );
        promptNumber("dialog.title.enterValue", this.defaultValue, (value) => {
            Transaction.execute(this.document, `excute ${this.featureType}`, () => {
                this.body.setFeaturesEmitShapeChanged([...this.body.features, this.feature(value, edges)]);
                this.document.visual.update();
            });
        });
    }

    private feature(value: number, edges: EdgeRef[]): FilletFeatureData | ChamferFeatureData {
        if (this.featureType === "fillet") {
            return { id: Id.generate(), type: "fillet", radius: value, edges };
        }
        return { id: Id.generate(), type: "chamfer", distance: value, edges };
    }
}

@command({ key: "feature.fillet", icon: "icon-fillet" })
export class FilletFeatureCommand extends EdgeCornerFeatureCommand {
    protected readonly featureType = "fillet" as const;
    protected readonly defaultValue = 2;
}

@command({ key: "feature.chamfer", icon: "icon-chamfer" })
export class ChamferFeatureCommand extends EdgeCornerFeatureCommand {
    protected readonly featureType = "chamfer" as const;
    protected readonly defaultValue = 1;
}
