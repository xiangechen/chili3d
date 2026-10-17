// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    Transaction,
} from "@chili3d/core";
import type { SewFeatureData } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";

/**
 * Sew: stitch a parametric body's face/shell chain output into one shell — the parametric
 * counterpart of `modify.sew`, narrowed to one body (no cross-node sewing; the feature's
 * doc comment in `sew.ts` carries the boundary). One pick: the body. The tolerance starts at
 * the app's repair-pass default and is edited in the floating options tab or on the row.
 */
@command({ key: "feature.sew", icon: "icon-sew" })
export class SewFeatureCommand extends MultistepCommand {
    @property("common.tolerance", { unit: LENGTH_UNITS })
    get tolerance(): ParameterValue {
        return this.getPrivateValue("tolerance", 1e-7);
    }
    set tolerance(value: ParameterValue) {
        this.setProperty("tolerance", value);
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const body = this.stepDatas[0].nodes?.[0];
        if (!(body instanceof ParametricBodyNode)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a parametric body");
            return;
        }
        const resolved = this.resolveParameter(this.tolerance, LENGTH_UNITS);
        if (!resolved.isOk || !(resolved.value > 0)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid tolerance");
            return;
        }

        Transaction.execute(this.document, "excute feature.sew", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature()]);
            this.document.visual.update();
        });
    }

    private feature(): SewFeatureData {
        return { id: Id.generate(), type: "sew", tolerance: this.tolerance };
    }
}
