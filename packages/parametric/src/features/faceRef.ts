// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, XYZ } from "@chili3d/core";
import { completeHistory, directionsParallel, distance, type Vec3, vec3 } from "./edgeRef";
import { captureRegionFingerprint } from "./profileRef";

/**
 * Geometric identity of a face for history completion: region identity (bbox
 * center + area, the ProfileRef recipe) plus the outward normal for planar faces.
 * A face the kernel history missed between two builds is bit-identical, so the
 * fingerprint only has to discriminate it from its REPLACEMENTS within one
 * operation — not to recognize a face across edits (that is what tracked ids and
 * PlaneFaceRef/ProfileRef do downstream).
 */
export interface FaceFingerprint {
    readonly center: Vec3;
    readonly area: number;
    /** Outward normal for planar faces only; either orientation describes the same plane. */
    readonly normal?: Vec3;
}

/** Captures the fingerprint once per face — scoring a live face per pair would pay kernel queries each. */
export function captureFaceFingerprint(face: IFace): FaceFingerprint {
    const planar = face.surface().isPlanar();
    return {
        ...captureRegionFingerprint(face),
        normal: planar ? vec3(face.normal(0, 0)[1]) : undefined,
    };
}

/**
 * Region similarity: center drift + area drift normalized by the face's own length
 * scale (ProfileRef's `regionScore` formula). A planar face never matches a
 * non-planar one, and two planar faces must share the plane's orientation — the
 * offset is already covered by the center term.
 */
function faceScoreFingerprints(a: FaceFingerprint, b: FaceFingerprint): number {
    if ((a.normal === undefined) !== (b.normal === undefined)) return Infinity;
    if (
        a.normal !== undefined &&
        b.normal !== undefined &&
        !directionsParallel(new XYZ(a.normal), new XYZ(b.normal))
    ) {
        return Infinity;
    }
    const length = Math.sqrt(Math.max(a.area, b.area));
    return distance(a.center, b.center) + Math.abs(a.area - b.area) / Math.max(length, 1e-9);
}

/**
 * Face specialization of `completeHistory` (see it for the claiming rules): an
 * unmapped output face inherits the input index of a fingerprint-identical input
 * face. Recovers the unchanged faces sparse kernel face histories (prism tops,
 * revolve caps and beyond) fail to report — the still-unmapped remainder keeps
 * its hand-seeded or feature-scoped id.
 */
export function completeFaceHistory(
    inputs: readonly IFace[],
    outputs: readonly IFace[],
    map: readonly number[],
): number[] {
    return completeHistory(inputs, outputs, map, captureFaceFingerprint, faceScoreFingerprints);
}
