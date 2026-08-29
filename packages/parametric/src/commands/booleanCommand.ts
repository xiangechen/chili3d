// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    MultistepCommand,
    ShapeNode,
    Transaction,
} from "@chili3d/core";
import type { BooleanOperation } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";

/** Shared flow for boolean features: pick a parametric body, then pick the tool bodies. */
abstract class BooleanFeatureCommand extends MultistepCommand {
    protected abstract readonly operation: BooleanOperation;

    private get body(): ParametricBodyNode {
        return this.stepDatas[0].nodes?.[0] as unknown as ParametricBodyNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
            new GetOrSelectNodeStep("prompt.select.models", {
                multiple: true,
                filter: {
                    allow: (node: INode) =>
                        node instanceof ShapeNode && node !== this.stepDatas[0].nodes?.[0],
                },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const toolIds = (this.stepDatas[1].nodes ?? []).map((node) => node.id);
        Transaction.execute(this.document, `excute feature.${this.operation}`, () => {
            this.body.setFeaturesEmitShapeChanged([
                ...this.body.features,
                { id: Id.generate(), type: "boolean", operation: this.operation, toolIds },
            ]);
            this.document.visual.update();
        });
    }
}

@command({ key: "feature.fuse", icon: "icon-booleanFuse" })
export class FuseFeatureCommand extends BooleanFeatureCommand {
    protected readonly operation = "fuse" as const;
}

@command({ key: "feature.cut", icon: "icon-booleanCut" })
export class CutFeatureCommand extends BooleanFeatureCommand {
    protected readonly operation = "cut" as const;
}

@command({ key: "feature.common", icon: "icon-booleanCommon" })
export class CommonFeatureCommand extends BooleanFeatureCommand {
    protected readonly operation = "common" as const;
}
