// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, Result, type XYZ } from "@chili3d/core";
import type { ExtrudeFeatureData, FeatureContext } from "./feature";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { sweepFaces } from "./sweepGeometry";
import { sweepFacesTracked } from "./sweepTracked";

/**
 * Press-pull: extruding from the planar faces of an EXISTING body, rather than from a
 * sketch's profiles.
 *
 * *Which* faces get swept is `sourceFaceMatcher.ts`'s business — the feature stores only
 * fingerprints of the faces picked at creation time, and they have to be re-found on a
 * shape that has since been rebuilt. The sweep itself names what it builds after the face it
 * pressed (`sweepTracked.ts`), so the pad's top is the source face's own image and a later
 * feature finds it by id; the boolean that combines the swept prism with the chain input is
 * the tracked half, and lives beside its sibling in extrude.ts (`pressPullOperationTracked`).
 */

/** What a press-pull sweep built: the solid plus the ids of its sub-shapes (findSubShapes order). */
export interface SourceFaceSweep {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Press-pull from planar faces of an existing body: every matched face sweeps along its own
 * live outward normal. See `matchSourceFaceIndexes` for which faces those are.
 *
 * The ids come back EMPTY when the source face carries none — nothing can name what a
 * nameless face swept, and the caller then has an untracked tool rather than a misnamed one.
 */
export function extrudeFromSourceFaces(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<SourceFaceSweep> {
    const resolved = resolveSourceFaces(feature.source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, edgeIdsOf, owned } = resolved.value;
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
        const faces = matched.value.indexes.map((index) => worldFaces[index]);
        const ids = matched.value.indexes.map((index) => faceIds?.[index]);
        // The pressed face's own edge ids, per swept face: a body face has no sketch-entity
        // attribution, so these are the only seeds a press-pull's pad can be named from
        // (see `sweepFaceTracked`).
        const ownEdgeIds = matched.value.indexes.map((index) => edgeIdsOf(index));
        // Each face sweeps along its OWN normal, so the direction differs per face.
        const vecsOf = (face: IFace): XYZ[] => {
            const vec = face.normal(0, 0)[1].multiply(depth);
            return feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
        };
        const offsetOf = (face: IFace) => face.normal(0, 0)[1].multiply(startOffset);

        const tracked = sweepFacesTracked(faces, ids, vecsOf, offsetOf, ownEdgeIds);
        if (tracked !== undefined) return tracked;
        const plain = sweepFaces(faces, vecsOf, offsetOf);
        if (!plain.isOk) return Result.err(plain.error);
        return Result.ok({ shape: plain.value, faceIds: [], edgeIds: [] });
    } finally {
        owned.forEach((x) => x.dispose());
    }
}
