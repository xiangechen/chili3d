// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, XYZ } from "@chili3d/core";
import { captureEdgeRef, refScoreRefs } from "./edgeRef";
import { captureRegionFingerprint } from "./profileRef";
import { directionsParallel, distance, MATCH_TOLERANCE, type Vec3, vec3 } from "./refGeometry";

/**
 * Completing a kernel history map by geometric identity.
 *
 * The tracked-id scheme (see `trackedId.ts`) rests on the kernel telling us which
 * output sub-shape derives from which input. It is a sparse report: a rebuild leaves
 * most sub-shapes bit-identical, and the kernel skips exactly those. Left alone, such
 * a sub-shape would look brand new and take a feature-scoped id, silently diverging
 * from the stable id a downstream ref stored.
 *
 * So an unmapped output is matched against the unclaimed inputs by geometric
 * fingerprint: identical geometry claims its index back, a fingerprint that is not a
 * clear winner claims nothing. The per-kind specializations below supply the
 * fingerprint and the score; `completeHistory` owns the claiming rules.
 *
 * The aggregation over both kinds is `completeTrackedHistory` in `feature.ts`, which
 * sits above these and adds the enumerated output sub-shapes its callers reuse.
 */

/**
 * Fills the `-1` entries of a kernel history map by exact geometric identity.
 *
 * - **The rule.** An unmapped output inherits the input index of a fingerprint-identical input:
 *   score within MATCH_TOLERANCE, the next rival at least MATCH_TOLERANCE farther, one claim
 *   per input. Inputs already claimed by the map are not stolen.
 * - **Why it is needed.** Parametric rebuilds leave most sub-shapes unchanged, and that is
 *   exactly the part sparse kernel histories fail to report.
 * - **Best-effort.** A sub-shape whose kernel queries fail (a degenerate edge or face) simply
 *   never claims or gets claimed.
 * - **Cost.** Fingerprints are captured once per candidate — unclaimed inputs and unmapped
 *   outputs only — and a fully mapped history returns without capturing at all. Scoring a live
 *   sub-shape per candidate pair would pay several kernel queries each, and the same output is
 *   scored against every unclaimed input.
 */
export function completeHistory<TShape, TRef>(
    inputs: readonly TShape[],
    outputs: readonly TShape[],
    map: readonly number[],
    capture: (shape: TShape) => TRef,
    score: (a: TRef, b: TRef) => number,
): number[] {
    const completed = [...map];
    // Nothing to complete: skip every fingerprint capture.
    if (!completed.some((index) => index < 0)) return completed;
    const claimed = new Set(completed.filter((index) => index >= 0));
    const inputRefs: { index: number; ref: TRef }[] = [];
    for (const [index, input] of inputs.entries()) {
        // Claimed inputs are skipped at scoring time — don't pay for their capture.
        if (claimed.has(index)) continue;
        try {
            inputRefs.push({ index, ref: capture(input) });
        } catch {
            // Degenerate input — it never claims an output.
        }
    }
    for (const [outputIndex, output] of outputs.entries()) {
        if (completed[outputIndex] === undefined || completed[outputIndex] >= 0) continue;
        let outputRef: TRef;
        try {
            outputRef = capture(output);
        } catch {
            // Degenerate output — its entry stays unmapped.
            continue;
        }
        let best = -1;
        let bestScore = Infinity;
        let secondScore = Infinity;
        for (const { index, ref } of inputRefs) {
            if (claimed.has(index)) continue;
            const candidateScore = score(ref, outputRef);
            if (candidateScore < bestScore) {
                secondScore = bestScore;
                bestScore = candidateScore;
                best = index;
            } else if (candidateScore < secondScore) {
                secondScore = candidateScore;
            }
        }
        if (best >= 0 && bestScore <= MATCH_TOLERANCE && secondScore - bestScore >= MATCH_TOLERANCE) {
            completed[outputIndex] = best;
            claimed.add(best);
        }
    }
    return completed;
}

/**
 * Edge specialization of `completeHistory` (see it for the claiming rules): the
 * fingerprint is the `EdgeRef`, the score the fingerprint distance. Recovers the
 * unchanged edges sparse kernel histories (e.g. revolve edges) fail to report.
 */
export function completeEdgeHistory(
    inputs: readonly IEdge[],
    outputs: readonly IEdge[],
    map: readonly number[],
): number[] {
    return completeHistory(inputs, outputs, map, captureEdgeRef, refScoreRefs);
}

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
