// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, Result, type XYZ } from "@chili3d/core";
import type { ExtrudePlan } from "./extrudeEnd";
import type { ExtrudeFeatureData, FeatureContext } from "./feature";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { sweepFaces } from "./sweepGeometry";
import { sweepFacesTracked, type TrackedPiece } from "./sweepTracked";

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

/**
 * Press-pull from planar faces of an existing body: every matched face sweeps from its own
 * plane, along its own live outward normal unless the plan carries a direction override.
 * See `matchSourceFaceIndexes` for which faces those are.
 *
 * The ids come back EMPTY when the source face carries none — nothing can name what a
 * nameless face swept, and the caller then has an untracked tool rather than a misnamed one.
 *
 * A non-zero `draftAngle` (degrees) tapers each prism's side faces about its source face's
 * plane as it is swept (`sweepFaceTracked`), carrying the ids through the taper.
 */
export function extrudeFromSourceFaces(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    plan: ExtrudePlan,
    draftAngle?: number,
): Result<TrackedPiece> {
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
            // A pick the source no longer has costs the user that face, not the whole
            // press-pull — the same tolerance the sketch-profile path keeps.
            if (matched.value.missing.length > 0) {
                context.tracking.unresolved = { key: "profiles", refIndexes: matched.value.missing };
            }
        }
        const faces = matched.value.indexes.map((index) => worldFaces[index]);
        const ids = matched.value.indexes.map((index) => faceIds?.[index]);
        // The pressed face's own edge ids, per swept face: a body face has no sketch-entity
        // attribution, so these are the only seeds a press-pull's pad can be named from
        // (see `sweepFaceTracked`).
        const ownEdgeIds = matched.value.indexes.map((index) => edgeIdsOf(index));
        // Each face's sweep vectors come from the plan evaluated at the face's OWN plane, so
        // they differ per face — an end condition measures from that plane, and the direction
        // is the face's outward normal unless the plan overrides it. Resolved up front, so a
        // target behind one face's start plane fails before any kernel sweep runs.
        const vecsByFace = new Map<IFace, XYZ[]>();
        for (const face of faces) {
            const [point, normal] = face.normal(0, 0);
            const vecs = plan.vecsOf(point, normal);
            if (!vecs.isOk) return Result.err(vecs.error);
            vecsByFace.set(face, vecs.value);
        }
        const vecsOf = (face: IFace) => vecsByFace.get(face)!;
        const offsetOf = (face: IFace) => plan.offsetOf(face.normal(0, 0)[1]);

        const tracked = sweepFacesTracked(faces, ids, vecsOf, offsetOf, ownEdgeIds, draftAngle);
        if (tracked !== undefined) return tracked;
        const plain = sweepFaces(faces, vecsOf, offsetOf, draftAngle);
        if (!plain.isOk) return Result.err(plain.error);
        return Result.ok({ shape: plain.value, faceIds: [], edgeIds: [] });
    } finally {
        owned.forEach((x) => x.dispose());
    }
}
