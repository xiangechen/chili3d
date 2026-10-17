// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Id,
    type IFace,
    type IStep,
    MultistepCommand,
    PubSub,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import type { RemoveFeatureFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { captureProfileRef } from "../features/profileRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SelectBodyFacesStep } from "./selectBodyFacesStep";

/**
 * Remove feature (Fusion's Delete Face with heal): delete picked faces of a parametric body
 * and let the kernel close the wound — the parametric counterpart of `modify.removeFeature`.
 * No new body: the removal rewrites the body it is applied to, exactly as a shell does, so
 * the command is `shellCommand.ts` stripped to its pick step — no parameters, no preview.
 */
@command({ key: "feature.removeFeature", icon: "icon-removeFeature" })
export class RemoveFeatureCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new SelectBodyFacesStep()];
    }

    protected override executeMainTask(): void {
        const body = this.stepDatas[0].nodes?.[0];
        const picked = this.stepDatas[0].shapes.filter((x) => x.shape.shapeType === ShapeTypes.face);
        if (!(body instanceof ParametricBodyNode) || picked.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select at least one face to remove");
            return;
        }

        const faces = picked.map((data) => {
            const faceId = body.faceIdAt(data.indexes[0]);
            if (faceId === undefined) {
                reportSilentIdLoss(body, "face", "a removed face has no tracked id");
            }
            return captureProfileRef(data.shape as unknown as IFace, faceId, body.faceIdIsShared(faceId));
        });
        Transaction.execute(this.document, "excute feature.removeFeature", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(faces)]);
            this.document.visual.update();
        });
    }

    private feature(faces: RemoveFeatureFeatureData["faces"]): RemoveFeatureFeatureData {
        return { id: Id.generate(), type: "removeFeature", faces };
    }
}
