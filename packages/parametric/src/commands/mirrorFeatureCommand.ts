// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    MultistepCommand,
    PubSub,
    property,
    Transaction,
} from "@chili3d/core";
import type { MirrorFeatureData } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";
import type { PickedNeutralPlane } from "../sketch/commands/planePickHandler";
import { SelectNeutralPlaneStep } from "./draftCommand";

/**
 * Mirror (Onshape's Mirror part): mirror a parametric body about a plane — a datum quad or a
 * planar face, picked with the draft command's own plane step — and fuse the reflection into it
 * (the default; the merge checkbox rides on the options panel and the feature row afterwards).
 *
 * No new body and no boolean scope — a mirror appends to the chain of the body it is applied to,
 * exactly as a shell or a draft does, so the flow is the boolean command's two picks with the
 * plane pick in place of the tool pick.
 */
@command({ key: "feature.mirror", icon: "icon-mirror" })
export class MirrorFeatureCommand extends MultistepCommand {
    /** Fuse the reflection into the input (the default) or keep both as an unmerged compound. */
    @property("option.command.merge")
    get merge(): boolean {
        return this.getPrivateValue("merge", true);
    }
    set merge(value: boolean) {
        this.setProperty("merge", value);
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
            PubSub.default.pub("showToast", "error.default:{0}", "Select a mirror plane");
            return;
        }

        Transaction.execute(this.document, "excute feature.mirror", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(plane.ref)]);
            this.document.visual.update();
        });
    }

    private feature(plane: MirrorFeatureData["plane"]): MirrorFeatureData {
        // `merge` absent is the default true; the checkbox stays editable on the feature row.
        return { id: Id.generate(), type: "mirror", plane, ...(this.merge ? {} : { merge: false }) };
    }
}
