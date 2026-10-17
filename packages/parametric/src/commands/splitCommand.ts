// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    command,
    GetOrSelectNodeStep,
    type I18nKeys,
    Id,
    type INode,
    type IStep,
    MultistepCommand,
    PubSub,
    property,
    Transaction,
} from "@chili3d/core";
import type { SplitFeatureData } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";
import type { PickedNeutralPlane } from "../sketch/commands/planePickHandler";
import { SelectNeutralPlaneStep } from "./draftCommand";

const KEEP_BOTH: I18nKeys = "option.command.keepSide.both";
const KEEP_POSITIVE: I18nKeys = "option.command.keepSide.positive";
const KEEP_NEGATIVE: I18nKeys = "option.command.keepSide.negative";

/**
 * Split: cut a parametric body's chain with a plane — a datum quad or a planar face, picked
 * with the draft command's own plane step — keeping both halves (one compound) or one side.
 *
 * No new body and no boolean scope — a split rewrites the body it is applied to, exactly as a
 * mirror does, so the flow is the mirror command's two picks (body, then plane). Which side to
 * keep starts at "both" and is edited on the feature row afterwards (or in the floating
 * options tab while the command runs).
 */
@command({ key: "feature.split", icon: "icon-split" })
export class SplitFeatureCommand extends MultistepCommand {
    @property("option.command.keepSide", {
        combobox: Combobox.from([KEEP_BOTH, KEEP_POSITIVE, KEEP_NEGATIVE]),
    })
    get keepSide(): I18nKeys {
        return this.getPrivateValue("keepSide", KEEP_BOTH);
    }
    set keepSide(value: I18nKeys) {
        this.setProperty("keepSide", value);
    }

    private plane: PickedNeutralPlane | undefined;

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
            new SelectNeutralPlaneStep((picked) => {
                this.plane = picked;
            }),
        ];
    }

    protected override executeMainTask(): void {
        const body = this.stepDatas[0].nodes?.[0];
        if (!(body instanceof ParametricBodyNode)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a parametric body");
            return;
        }
        const plane = this.plane;
        if (plane === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a split plane");
            return;
        }

        Transaction.execute(this.document, "excute feature.split", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(plane.ref)]);
            this.document.visual.update();
        });
    }

    private feature(tool: SplitFeatureData["tool"]): SplitFeatureData {
        const keepSide =
            this.keepSide === KEEP_POSITIVE
                ? "positive"
                : this.keepSide === KEEP_NEGATIVE
                  ? "negative"
                  : undefined;
        // `both` is the default — left unset rather than stored, like the mirror's merge.
        return { id: Id.generate(), type: "split", tool, ...(keepSide === undefined ? {} : { keepSide }) };
    }
}
