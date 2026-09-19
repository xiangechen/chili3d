// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IEdge, type IFace, XYZ, type XYZLike } from "@chili3d/core";
import { captureEdgeRef, mayOverlap, refScoreRefs } from "./edgeRef";
import { edgeLiesOn } from "./profileEntities";
import { captureRegionFingerprint } from "./profileRef";
import { directionsParallel, distance, MATCH_TOLERANCE, plainVec } from "./refGeometry";

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
 *   scored against every unclaimed input. VERIFYING a claim (`verifiedMap`) is a separate pass
 *   that runs whenever anything is claimed — a fully mapped history still pays that, and it is
 *   what keeps a lying kernel index out.
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
    const inputRefs = captureUnclaimed(inputs, claimed, capture);
    for (const [outputIndex, output] of outputs.entries()) {
        if (completed[outputIndex] === undefined || completed[outputIndex] >= 0) continue;
        // A degenerate output claims nothing — its entry stays unmapped.
        const outputRef = tryCapture(output, capture);
        if (outputRef === undefined) continue;

        const match = nearestUnclaimed(inputRefs, claimed, outputRef, score);
        // The winner has to be within tolerance AND clear of its runner-up.
        if (match.index < 0 || match.best > MATCH_TOLERANCE || match.second - match.best < MATCH_TOLERANCE) {
            continue;
        }
        completed[outputIndex] = match.index;
        claimed.add(match.index);
    }
    return completed;
}

/**
 * The unclaimed inputs with their fingerprints. Claimed inputs are skipped here rather than
 * at scoring time — their fingerprint would only be discarded.
 */
function captureUnclaimed<TShape, TRef>(
    inputs: readonly TShape[],
    claimed: ReadonlySet<number>,
    capture: (shape: TShape) => TRef,
): { index: number; ref: TRef }[] {
    const refs: { index: number; ref: TRef }[] = [];
    for (const [index, input] of inputs.entries()) {
        if (claimed.has(index)) continue;
        const ref = tryCapture(input, capture);
        // A degenerate input — it never claims an output.
        if (ref !== undefined) refs.push({ index, ref });
    }
    return refs;
}

/**
 * The unclaimed input closest to `outputRef`, if any, with the runner-up's score — the gap
 * between the two is what tells a clear winner from a tie.
 */
function nearestUnclaimed<TRef>(
    inputRefs: readonly { index: number; ref: TRef }[],
    claimed: ReadonlySet<number>,
    outputRef: TRef,
    score: (a: TRef, b: TRef) => number,
): { index: number; best: number; second: number } {
    let index = -1;
    let best = Number.POSITIVE_INFINITY;
    let second = Number.POSITIVE_INFINITY;
    for (const candidate of inputRefs) {
        if (claimed.has(candidate.index)) continue;
        const candidateScore = score(candidate.ref, outputRef);
        if (candidateScore < best) {
            second = best;
            best = candidateScore;
            index = candidate.index;
        } else if (candidateScore < second) {
            second = candidateScore;
        }
    }
    return { index, best, second };
}

/** The fingerprint of one candidate sub-shape; undefined when a kernel query on it fails. */
function tryCapture<TShape, TRef>(shape: TShape, capture: (shape: TShape) => TRef): TRef | undefined {
    try {
        return capture(shape);
    } catch {
        return undefined;
    }
}

/**
 * Edge specialization of `completeHistory` (see it for the claiming rules): the
 * fingerprint is the `EdgeRef`, the score the fingerprint distance. Recovers the
 * unchanged edges sparse kernel histories (e.g. revolve edges) fail to report.
 *
 * **A kernel claim is verified before it is kept.** A boolean's history reports indexes
 * into its own input enumeration, and `SimplifyResult` can leave those indexes pointing at
 * a sub-shape the output does not derive from at all — measured: fusing two half-prisms
 * made the merged box's TOP edge inherit the bottom edge's index, so the content-derived
 * id named an edge 10mm away. Such an entry is dropped here and re-claimed by geometry
 * below, where the true ancestor is unambiguous (the two are bit-identical).
 *
 * **What counts as consistent** is `edgeLiesOn` in EITHER direction, which accepts the two
 * shapes a real derivation takes — a TRIMMED piece of the ancestor, and the MERGE of
 * several ancestors into a longer one (the piece lies on the merged output).
 */
export function completeEdgeHistory(
    inputs: readonly IEdge[],
    outputs: readonly IEdge[],
    map: readonly number[],
): number[] {
    return completeHistory(
        inputs,
        outputs,
        verifiedClaims(outputs, inputs, map),
        captureEdgeRef,
        refScoreRefs,
    );
}

/** `map` with every positive entry whose claimed input the output does not lie on (either way) dropped. */
function verifiedClaims(
    outputs: readonly IEdge[],
    inputs: readonly IEdge[],
    map: readonly number[],
): number[] {
    return verifiedMap(outputs, inputs, map, edgesConsistent);
}

/** True when `output` and `input` are two shapes a real derivation takes (see `completeEdgeHistory`). */
function edgesConsistent(output: IEdge, input: IEdge): boolean {
    try {
        return edgeLiesOn(output, input) || edgeLiesOn(input, output);
    } catch {
        // A degenerate side: nothing to verify against — keep the claim.
        return true;
    }
}

/**
 * The kernel's EDGE derivation pairs, verified the way `completeEdgeHistory` verifies its map.
 *
 * The pairs are the merge channel — a sub-shape derived from several inputs records each of
 * them, which is what lets a merged edge carry every ancestor's id instead of just the first
 * one the single-valued map kept. They come from the same kernel report as the map and lie the
 * same way: measured, fusing a half prism onto a taller one put 6 of 21 pairs on an input the
 * output does not touch at all (parallel spans on the same line, one junction apart), while
 * `edgeLiesOn` accepts every legitimate trim and merge.
 */
export function verifiedEdgeAncestors(
    pairs: readonly number[] | undefined,
    outputs: readonly IEdge[],
    inputs: readonly IEdge[],
): number[] | undefined {
    return verifiedPairs(pairs, outputs, inputs, edgesConsistent);
}

/**
 * The kernel's FACE derivation pairs, verified by bounding-box overlap.
 *
 * Weaker than the edge test on purpose: a face derivation can only be checked by what the
 * face occupies (a trim, a merge and an untouched face all stay inside their ancestor's box),
 * and box overlap still rejects the failure the pairs are known for — measured, fusing a half
 * prism onto a taller one paired a top face at z=20 with an input face at z=10.
 */
export function verifiedFaceAncestors(
    pairs: readonly number[] | undefined,
    outputs: readonly IFace[],
    inputs: readonly IFace[],
): number[] | undefined {
    return verifiedPairs(pairs, outputs, inputs, facesConsistent);
}

/** True when two boxes share a point — the two sub-shapes a real derivation takes never touch elsewhere. */
function facesConsistent(output: IFace, input: IFace): boolean {
    try {
        return BoundingBox.isIntersect(output.boundingBox(), input.boundingBox(), MATCH_TOLERANCE);
    } catch {
        return true;
    }
}

/**
 * The input edges every output edge is a merge of, recovered GEOMETRICALLY rather than from
 * the kernel's pairs.
 *
 * Why it is needed: a fuse of touching swept prisms MERGES collinear input pieces into one
 * output edge, and the merged edge has to carry every piece's id — a ref the user picked on
 * one half must keep intersecting the whole. The kernel's pairs are the cheaper source, but
 * they carry indexes the geometry contradicts (`verifiedEdgeAncestors`, measured: fusing two
 * swept regions of one sketch put a merged edge's second ancestor on a corner a metre away).
 * Dropping those would silently UN-merge the edge, so the merge channel is asked again, from
 * the geometry: every input that overlaps the output belongs to it.
 *
 * Cost is bounded by a fingerprint prefilter (`mayOverlap`): only the pairs whose fingerprints
 * can describe overlapping geometry reach the exact `edgeLiesOn` probe.
 */
export function mergedEdgeAncestors(
    outputs: readonly IEdge[],
    inputs: readonly IEdge[],
): number[] | undefined {
    const candidates = inputs.map((edge, index) => ({ index, ref: tryCapture(edge, captureEdgeRef) }));
    const pairs: number[] = [];
    for (const [outputIndex, output] of outputs.entries()) {
        const ref = tryCapture(output, captureEdgeRef);
        if (ref === undefined) continue;
        for (const candidate of candidates) {
            if (candidate.ref === undefined || !mayOverlap(ref, candidate.ref)) continue;
            if (!edgesConsistent(output, inputs[candidate.index])) continue;
            pairs.push(outputIndex, candidate.index);
        }
    }
    return pairs.length > 0 ? pairs : undefined;
}

/** Both pair lists as one, without duplicate (output, input) pairs. */
export function unionAncestors(
    first: readonly number[] | undefined,
    second: readonly number[] | undefined,
): number[] | undefined {
    if (first === undefined) return second === undefined ? undefined : [...second];
    if (second === undefined) return [...first];
    const seen = new Set<string>();
    const union: number[] = [];
    for (const pairs of [first, second]) {
        for (let i = 0; i + 1 < pairs.length; i += 2) {
            const key = `${pairs[i]}:${pairs[i + 1]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            union.push(pairs[i], pairs[i + 1]);
        }
    }
    return union;
}

/**
 * Keeps the (output, input) pairs that survive `consistent`; undefined stays undefined.
 * The shared body of `verifiedEdgeAncestors`/`verifiedFaceAncestors`.
 */
function verifiedPairs<TShape>(
    pairs: readonly number[] | undefined,
    outputs: readonly TShape[],
    inputs: readonly TShape[],
    consistent: (output: TShape, input: TShape) => boolean,
): number[] | undefined {
    if (pairs === undefined) return undefined;
    const verified: number[] = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
        const [outputIndex, inputIndex] = [pairs[i], pairs[i + 1]];
        const output = outputs[outputIndex];
        const input = inputs[inputIndex];
        if (output === undefined || input === undefined) continue;
        if (!consistent(output, input)) continue;
        verified.push(outputIndex, inputIndex);
    }
    return verified;
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
    readonly center: XYZLike;
    readonly area: number;
    /** Outward normal for planar faces only; either orientation describes the same plane. */
    readonly normal?: XYZLike;
}

/** Captures the fingerprint once per face — scoring a live face per pair would pay kernel queries each. */
export function captureFaceFingerprint(face: IFace): FaceFingerprint {
    const planar = face.surface().isPlanar();
    return {
        ...captureRegionFingerprint(face),
        normal: planar ? plainVec(face.normal(0, 0)[1]) : undefined,
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
    return completeHistory(
        inputs,
        outputs,
        verifiedFaceClaims(outputs, inputs, map),
        captureFaceFingerprint,
        faceScoreFingerprints,
    );
}

/**
 * `map` with every positive entry whose claimed input the output does not overlap dropped — the
 * face counterpart of `verifiedClaims`, and needed for the same reason: measured, a symmetric
 * extrude's fused −z cap inherited the index of the HALF's profile face (a face at z=0, twenty
 * millimetres away), so the cap was named with the wrong half's seed. Dropping it lets the
 * completion re-claim the true ancestor by fingerprint.
 *
 * The criterion is deliberately weaker than the edge one — a face can only be judged by the box
 * it occupies — so a derivation that is geometrically odd yet box-overlapping still passes.
 * There is no geometric face MERGE sweep to fall back on (see `mergedEdgeAncestors`): a dropped
 * legitimate merge would un-name a fused face, which is the residual risk this accepts.
 */
function verifiedFaceClaims(
    outputs: readonly IFace[],
    inputs: readonly IFace[],
    map: readonly number[],
): number[] {
    return verifiedMap(outputs, inputs, map, facesConsistent);
}

/** `map` with every positive entry `consistent` rejects turned back into "unmapped". */
function verifiedMap<TShape>(
    outputs: readonly TShape[],
    inputs: readonly TShape[],
    map: readonly number[],
    consistent: (output: TShape, input: TShape) => boolean,
): number[] {
    // Nothing claimed, nothing to verify: the enum's fast path stays fast.
    if (!map.some((index) => index >= 0)) return [...map];
    return map.map((inputIndex, outputIndex) => {
        if (inputIndex < 0 || inputIndex >= inputs.length) return inputIndex;
        return consistent(outputs[outputIndex], inputs[inputIndex]) ? inputIndex : -1;
    });
}
