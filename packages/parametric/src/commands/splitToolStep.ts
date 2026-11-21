// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { AsyncController, IDocument, IFace, IStep, SnapResult } from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import type { SplitFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { captureProfileRef } from "../features/profileRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import {
    captureNeutralPlane,
    type PickedNeutralPlane,
    PlanePickHandler,
    type PlanePickResult,
} from "../sketch/commands/planePickHandler";

export type PickedSplitTool =
    | { readonly kind: "plane"; readonly picked: PickedNeutralPlane; readonly ref: SplitFeatureData["tool"] }
    | { readonly kind: "surface"; readonly face: IFace; readonly ref: SplitFeatureData["tool"] };

export class SelectSplitToolStep implements IStep {
    constructor(private readonly onPicked: (picked: PickedSplitTool) => void) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        document.selection.clearSelection();
        const handler = new PlanePickHandler(document, controller, true);
        await document.picker.pickAsync(
            handler,
            "prompt.select.splitTool",
            controller,
            "none",
            "select.default",
        );
        const result = handler.result;
        controller.dispose();
        handler.dispose();
        document.selection.clearSelection();
        if (result === undefined) return undefined;

        const picked = captureSplitTool(document, result);
        const view = document.application.activeView;
        if (picked === undefined || view === undefined) return undefined;
        this.onPicked(picked);
        return {
            view,
            shapes: [],
            type: "input",
            plane: picked.kind === "plane" ? picked.picked.plane : undefined,
        };
    }
}

function captureSplitTool(document: IDocument, result: PlanePickResult): PickedSplitTool | undefined {
    if (result.kind !== "face" || (result.data.shape as IFace).surface().isPlanar()) {
        const picked = captureNeutralPlane(document, result);
        return picked === undefined ? undefined : { kind: "plane", picked, ref: picked.ref };
    }
    const owner = document.visual.context.getNode(result.data.owner);
    if (owner === undefined) return undefined;
    const worldFace = result.data.shape.transformedMul(result.data.transform) as IFace;
    let faceId: string | undefined;
    let splitPiece: boolean | undefined;
    if (isBodyTrackingNode(owner)) {
        faceId = owner.faceIdAt(result.data.indexes[0]);
        splitPiece = owner instanceof ParametricBodyNode && owner.faceIdIsShared(faceId);
        if (faceId === undefined) {
            reportSilentIdLoss(owner, "face", "a picked split surface has no tracked id");
        }
    }
    return {
        kind: "surface",
        face: worldFace,
        ref: {
            kind: "surface",
            nodeId: owner.id,
            profiles: [captureProfileRef(worldFace, faceId, splitPiece, true)],
        },
    };
}
