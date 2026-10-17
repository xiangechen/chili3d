// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, Result, ShapeTypes } from "@chili3d/core";
import {
    type FeatureContext,
    type FeatureHandler,
    type RemoveFeatureFeatureData,
    registerFeature,
} from "./feature";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes } from "./sourceFaceMatcher";

/**
 * Remove feature (Fusion's Delete Face with heal): delete the named faces of the chain
 * input and let the kernel close the wound.
 *
 * Structured like `shell.ts` — the same relationship to its input (faces named as
 * `ProfileRef` fingerprints OF the chain input, matched against `context.input` itself
 * because the kernel identifies them by identity), with the kernel call being
 * `IShapeFactory.removeFeature` rather than a hollow. What it does NOT have is a tracked
 * variant: the kernel reports no history for the removal, so the result's ids degrade to
 * geometric matching (the `trackedIds` fallback in `feature.ts`) and a reference anchored
 * across the removal re-matches by fingerprint.
 */
const removeFeatureHandler: FeatureHandler<RemoveFeatureFeatureData> = {
    display: "command.feature.removeFeature",
    icon: "icon-removeFeature",
    reselectable: true,

    nodeIds: () => [],

    parameters: () => [],

    setParameter: (feature) => feature,

    applyResolvedRefs: (feature, { resolvedProfiles }) =>
        resolvedProfiles === undefined ? feature : { ...feature, faces: resolvedProfiles },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Remove feature requires a preceding feature");
        const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
        const faceIds = context.tracking?.inputFaceIds;
        const matched = matchSourceFaceIndexes(faces, faceIds, feature.faces);
        if (!matched.isOk) return Result.err(matched.error);
        // Every pick gone is an error — the feature would otherwise rebuild to the input
        // and pretend a removal happened. SOME picks gone costs only those removals.
        if (matched.value.indexes.length === 0) {
            return Result.err("Remove feature: none of the faces it names exist anymore");
        }
        if (context.tracking !== undefined) {
            context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
                captureProfileRef(
                    faces[faceIndex],
                    faceIds?.[faceIndex],
                    feature.faces[matched.value.refIndexes[k]].splitPiece,
                ),
            );
            if (matched.value.missing.length > 0) {
                context.tracking.unresolved = { key: "faces", refIndexes: matched.value.missing };
            }
        }
        return shapeFactory.removeFeature(
            input,
            matched.value.indexes.map((index) => faces[index]),
        );
    },
};

registerFeature("removeFeature", removeFeatureHandler);
