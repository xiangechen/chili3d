// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, Result, ShapeTypes } from "@chili3d/core";
import { bestEdgeScore, captureEdgeRef, type EdgeRef, MATCH_TOLERANCE } from "./edgeRef";

/**
 * A geometric fingerprint of a sketch profile (one closed loop): the fingerprints of
 * its boundary edges. Sketch faces have no kernel-stable ids (they are derived by
 * `sketchProfiles`, not stored), so the edge fingerprints are the only identity — like
 * `EdgeRef`, they match exactly while the sketch is unchanged and re-match by
 * proximity after edits. See `matchProfileIndexes`.
 */
export interface ProfileRef {
    readonly edges: EdgeRef[];
}

export function captureProfileRef(face: IFace): ProfileRef {
    const edges = (face.findSubShapes(ShapeTypes.edge) as IEdge[]).map((edge) => captureEdgeRef(edge));
    return { edges };
}

/**
 * Re-matches stored profile refs against the faces of a rebuilt sketch, returning
 * positions in the given face array (the combined `[...outer, ...inner]` profile
 * list). Faces are scored jointly: a candidate's score is the sum of its per-edge
 * `bestEdgeScore`s. Matching runs in two phases:
 * 1. exact hits (within tolerance) lock in first — unmoved profiles are claimed before
 *    moved ones compete for the leftovers, so a moved circle cannot lose against
 *    identical circles that are still in place. Several exact faces for one ref, or
 *    two refs claiming the same face, are ambiguous;
 * 2. moved profiles re-match geometrically among the remaining faces: the closest face
 *    is accepted only when clearly closer than every other (same rule as `EdgeRef`
 *    moved geometry).
 */
export function matchProfileIndexes(faces: IFace[], refs: ProfileRef[]): Result<number[]> {
    const indexes: (number | undefined)[] = refs.map(() => undefined);
    const taken = new Set<number>();

    const moved = lockExactMatches(faces, refs, indexes, taken);
    if (!moved.isOk) return Result.err(moved.error);

    for (const refIndex of moved.value) {
        const match = clearestRemainingFace(faces, refs[refIndex], taken);
        if (match === undefined) return Result.err("Sketch profile not found after rebuild");
        if (match === -1) return Result.err("Sketch profile match is ambiguous after rebuild");
        taken.add(match);
        indexes[refIndex] = match;
    }
    return Result.ok(indexes as number[]);
}

/**
 * Phase 1: claims the single exact hit (within tolerance) of every ref, returning the
 * indexes of refs without one (the moved profiles). Several exact faces for one ref,
 * or two refs claiming the same face, are ambiguous.
 */
function lockExactMatches(
    faces: IFace[],
    refs: ProfileRef[],
    indexes: (number | undefined)[],
    taken: Set<number>,
): Result<number[]> {
    const moved: number[] = [];
    for (const [refIndex, ref] of refs.entries()) {
        const exact: number[] = [];
        for (const [index, face] of faces.entries()) {
            if (profileScore(face, ref) <= MATCH_TOLERANCE * ref.edges.length) exact.push(index);
        }
        if (exact.length > 1 || (exact.length === 1 && taken.has(exact[0]))) {
            return Result.err("Sketch profile match is ambiguous after rebuild");
        }
        if (exact.length === 1) {
            taken.add(exact[0]);
            indexes[refIndex] = exact[0];
        } else {
            moved.push(refIndex);
        }
    }
    return Result.ok(moved);
}

/** Phase 2: the remaining face closest to a moved ref — undefined when none, -1 when ambiguous. */
function clearestRemainingFace(faces: IFace[], ref: ProfileRef, taken: Set<number>): number | undefined {
    const scored: { index: number; score: number }[] = [];
    for (const [index, face] of faces.entries()) {
        if (taken.has(index)) continue;
        const score = profileScore(face, ref);
        if (Number.isFinite(score)) scored.push({ index, score });
    }
    return pickClearWinner(scored, ref.edges.length);
}

/** Sum of the ref's per-edge `bestEdgeScore`s; Infinity when the edge count differs. */
function profileScore(face: IFace, ref: ProfileRef): number {
    const edges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    if (edges.length !== ref.edges.length) return Infinity;
    let score = 0;
    for (const edgeRef of ref.edges) {
        score += bestEdgeScore(edges, edgeRef);
    }
    return score;
}

/**
 * The winning candidate index, undefined when nothing matches, -1 when ambiguous.
 * Exact hits (within tolerance) win outright — several are ambiguous; without one,
 * the best score must be at least 50% better than the runner-up.
 */
function pickClearWinner(scored: { index: number; score: number }[], edgeCount: number): number | undefined {
    if (scored.length === 0) return undefined;
    const exact = scored.filter((x) => x.score <= MATCH_TOLERANCE * edgeCount);
    if (exact.length > 1) return -1;
    if (exact.length === 1) return exact[0].index;
    scored.sort((a, b) => a.score - b.score);
    const [best, second] = scored;
    if (second === undefined || second.score > 1.5 * best.score + MATCH_TOLERANCE * edgeCount) {
        return best.index;
    }
    return -1;
}
