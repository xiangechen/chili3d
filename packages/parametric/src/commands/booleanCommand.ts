// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    isReferenceGeometryNode,
    MultistepCommand,
    PubSub,
    property,
    ShapeNode,
    Transaction,
} from "@chili3d/core";
import { captureBooleanToolFeatureCounts } from "../features/boolean";
import type { BooleanOperation } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";

/** Shared flow for boolean features: pick a parametric body, then pick the tool bodies. */
abstract class BooleanFeatureCommand extends MultistepCommand {
    protected abstract readonly operation: BooleanOperation;

    @property("features.consumeTools")
    get consumeTools() {
        return this.getPrivateValue("consumeTools", true);
    }
    set consumeTools(value: boolean) {
        this.setProperty("consumeTools", value);
    }

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
                        node instanceof ShapeNode &&
                        !isReferenceGeometryNode(node) &&
                        node !== this.stepDatas[0].nodes?.[0],
                },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const tools = this.stepDatas[1].nodes ?? [];
        const captured = captureBooleanToolFeatureCounts(tools);
        if (!captured.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", captured.error);
            return;
        }
        Transaction.execute(this.document, `excute feature.${this.operation}`, () => {
            this.body.setFeaturesEmitShapeChanged([
                ...this.body.features,
                {
                    id: Id.generate(),
                    type: "boolean",
                    operation: this.operation,
                    toolIds: tools.map((node) => node.id),
                    toolFeatureCounts: captured.value,
                    consumeTools: this.consumeTools,
                },
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
