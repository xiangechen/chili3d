// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, Result } from "@chili3d/core";
import { type ProfileRef, profileScore, regionScore } from "./profileRef";
import { MATCH_TOLERANCE } from "./refGeometry";

/**
 * Re-finding stored profile references on a rebuilt sketch.
 *
 * The profile side of the same problem `edgeMatcher.ts` solves for edges, but a region
 * has one identity signal an edge does not: the set of sketch entities bounding it
 * (`ProfileRef.entities`). On a crossing sketch, two adjacent regions share segments of
 * the same entities, so their geometric fingerprints are near-identical — the entity set
 * is what tells them apart, and it is therefore consulted first.
 *
 * The three phases are documented on `matchProfileIndexes` below.
 */

/**
 * Re-matches stored profile refs against the faces of a rebuilt sketch, returning positions in
 * the given face array (the combined `[...outer, ...inner]` profile list). `entities` carries
 * the entity-id sets of crossing-path faces, parallel to `faces` and undefined on the
 * connectivity path.
 *
 * Three phases:
 * 0. **Entity sets first.** A ref carrying one claims the faces bounded by the same sketch
 *    entities — geometric fingerprints cannot tell adjacent regions of a crossing sketch apart,
 *    since they share complementary segments of the same entities. Candidates sharing a set
 *    (e.g. the lens regions of two crossing circles) are tiebroken by the region fingerprint; a
 *    ref with no entity-set candidate falls through, as the crossing pattern may have changed.
 * 1. **Exact hits lock in.** Unmoved profiles are claimed (within tolerance) before moved ones
 *    compete for the leftovers, so a moved circle cannot lose against identical circles that
 *    are still in place. Several exact faces for one ref, or two refs claiming one face, is
 *    ambiguous.
 * 2. **Then moved profiles re-match geometrically** among the remaining faces: the closest is
 *    accepted only when clearly closer than every other (the same rule as `EdgeRef` moved
 *    geometry). Faces score jointly — a candidate's score sums its per-edge `bestEdgeScore`s.
 *
 * `allow` restricts phases 1–2 to eligible (ref, face) pairs; the press-pull source matcher uses
 * it to keep refs whose tracked id died away from faces carrying a live id of their own. Phase 0
 * is identity-based already and ignores it.
 */
export function matchProfileIndexes(
    faces: IFace[],
    refs: ProfileRef[],
    entities?: (number[] | undefined)[],
    allow?: (refIndex: number, faceIndex: number) => boolean,
): Result<number[]> {
    const indexes: (number | undefined)[] = refs.map(() => undefined);
    const taken = new Set<number>();

    let remaining = refs.map((_, index) => index);
    if (entities !== undefined) {
        const locked = lockEntityMatches(faces, refs, entities, indexes, taken);
        if (!locked.isOk) return Result.err(locked.error);
        remaining = locked.value;
    }

    const moved = lockExactMatches(faces, refs, indexes, taken, remaining, allow);
    if (!moved.isOk) return Result.err(moved.error);

    for (const refIndex of moved.value) {
        const match = clearestRemainingFace(faces, refs, refIndex, taken, allow);
        if (match === undefined) return Result.err("Sketch profile not found after rebuild");
        if (match === -1) return Result.err("Sketch profile match is ambiguous after rebuild");
        taken.add(match);
        indexes[refIndex] = match;
    }
    return Result.ok(indexes as number[]);
}

/**
 * Phase 0: refs with an entity set claim the untaken faces bounded by the same sketch
 * entities; ties within a set are broken by the lowest region score, near-equal scores
 * are ambiguous. Refs without a matching candidate keep going to the geometric phases.
 */
function lockEntityMatches(
    faces: IFace[],
    refs: ProfileRef[],
    entities: (number[] | undefined)[],
    indexes: (number | undefined)[],
    taken: Set<number>,
): Result<number[]> {
    const remaining: number[] = [];
    for (const [refIndex, ref] of refs.entries()) {
        if (ref.entities === undefined) {
            remaining.push(refIndex);
            continue;
        }
        const candidates: { index: number; score: number }[] = [];
        for (const [index, set] of entities.entries()) {
            if (taken.has(index) || set === undefined || !sameEntitySet(set, ref.entities)) continue;
            candidates.push({ index, score: regionScore(faces[index], ref) });
        }
        if (candidates.length === 0) {
            remaining.push(refIndex);
            continue;
        }
        candidates.sort((a, b) => a.score - b.score);
        const [best, second] = candidates;
        if (second !== undefined && second.score - best.score <= MATCH_TOLERANCE) {
            return Result.err("Sketch profile match is ambiguous after rebuild");
        }
        taken.add(best.index);
        indexes[refIndex] = best.index;
    }
    return Result.ok(remaining);
}

/** Two entity-id sets are equal when their sorted unique contents are. */
function sameEntitySet(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort((x, y) => x - y);
    const sortedB = [...b].sort((x, y) => x - y);
    return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * Phase 1: claims the single exact hit (within tolerance) of every ref in
 * `refIndexes`, returning the indexes of refs without one (the moved profiles).
 * Several exact faces for one ref, or two refs claiming the same face, are ambiguous.
 */
function lockExactMatches(
    faces: IFace[],
    refs: ProfileRef[],
    indexes: (number | undefined)[],
    taken: Set<number>,
    refIndexes: number[],
    allow?: (refIndex: number, faceIndex: number) => boolean,
): Result<number[]> {
    const moved: number[] = [];
    for (const refIndex of refIndexes) {
        const ref = refs[refIndex];
        const exact: number[] = [];
        for (const [index, face] of faces.entries()) {
            if (allow !== undefined && !allow(refIndex, index)) continue;
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
function clearestRemainingFace(
    faces: IFace[],
    refs: ProfileRef[],
    refIndex: number,
    taken: Set<number>,
    allow?: (refIndex: number, faceIndex: number) => boolean,
): number | undefined {
    const scored: { index: number; score: number }[] = [];
    for (const [index, face] of faces.entries()) {
        if (taken.has(index)) continue;
        if (allow !== undefined && !allow(refIndex, index)) continue;
        const score = profileScore(face, refs[refIndex]);
        if (Number.isFinite(score)) scored.push({ index, score });
    }
    return pickClearWinner(scored, refs[refIndex].edges.length);
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
