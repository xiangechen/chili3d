// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Result } from "@chili3d/core";
import type { ExtrudeFeatureData, FeatureContext } from "./feature";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { sweepFaces } from "./sweepGeometry";

/**
 * Press-pull: extruding from the planar faces of an EXISTING body, rather than from a
 * sketch's profiles.
 *
 * *Which* faces get swept is `sourceFaceMatcher.ts`'s business — the feature stores only
 * fingerprints of the faces picked at creation time, and they have to be re-found on a
 * shape that has since been rebuilt. The sweep itself (`sweepGeometry.ts`) is
 * deliberately untracked; the boolean that combines the swept prism with the chain input
 * is the tracked half, and lives beside its sibling in extrude.ts
 * (`pressPullOperationTracked`).
 */

/**
 * Press-pull from planar faces of an existing body: every matched face sweeps along its own
 * live outward normal. See `matchSourceFaceIndexes` for which faces those are.
 */
export function extrudeFromSourceFaces(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> {
    const resolved = resolveSourceFaces(feature.source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, owned } = resolved.value;
    try {
        const matched = matchSourceFaceIndexes(worldFaces, faceIds, feature.source.profiles);
        if (!matched.isOk) return Result.err(matched.error);
        // Re-anchor on the faces actually swept — one ref per adopted face, so a face
        // split since the pick becomes one ref per piece — before the finally disposes
        // worldFaces. Each re-anchored ref keeps the `splitPiece` of the ref that
        // adopted it; re-anchoring never stamps the flag on a ref that lacked it.
        // Same drift-from-latest-match contract as the sketch path.
        if (context.tracking !== undefined) {
            context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
                captureProfileRef(
                    worldFaces[faceIndex],
                    faceIds?.[faceIndex],
                    feature.source.profiles[matched.value.refIndexes[k]].splitPiece,
                    true,
                ),
            );
        }
        return sweepFaces(
            matched.value.indexes.map((index) => worldFaces[index]),
            (face) => {
                const vec = face.normal(0, 0)[1].multiply(depth);
                return feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
            },
            (face) => face.normal(0, 0)[1].multiply(startOffset),
        );
    } finally {
        owned.forEach((x) => x.dispose());
    }
}
