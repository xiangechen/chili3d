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
 * The three phases are documented on `matchProfileIndexes` below, and the post-failure
 * probe that tells a LOST pick from a moved one on `matchProfilesTolerant`.
 */

/**
 * The two ways a profile ref can fail, as values rather than sentences: callers tell
 * "the pick is gone" (recoverable — a feature with several picks can build from the
 * rest and say so) from "the pick is ambiguous" (not recoverable — guessing which of
 * two candidates the user meant is worse than refusing).
 */
export const PROFILE_NOT_FOUND = "Sketch profile not found after rebuild";
export const PROFILE_AMBIGUOUS = "Sketch profile match is ambiguous after rebuild";

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
    return matchIndexes(faces, refs, entities, allow, "accept");
}

/**
 * How phase 2 treats a candidate with nothing to compare it against: `"accept"` takes the
 * sole finite-scoring leftover (the group match does — a moved profile that lost its rivals
 * to the earlier refs is still that ref's face), `"reject"` refuses it (the probe does, see
 * `claimFreeFace`).
 */
type LoneCandidate = "accept" | "reject";

function matchIndexes(
    faces: IFace[],
    refs: ProfileRef[],
    entities: (number[] | undefined)[] | undefined,
    allow: ((refIndex: number, faceIndex: number) => boolean) | undefined,
    lone: LoneCandidate,
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
        const match = clearestRemainingFace(faces, refs, refIndex, taken, allow, lone);
        if (match === undefined) return Result.err(PROFILE_NOT_FOUND);
        if (match === -1) return Result.err(PROFILE_AMBIGUOUS);
        taken.add(match);
        indexes[refIndex] = match;
    }
    return Result.ok(indexes as number[]);
}

/** What a tolerant match found, and what it could not: `missing` holds the positions in `refs` no face matched. */
export interface MatchedProfiles {
    /** The matched faces' positions in `faces`, in `refIndexes` order. */
    readonly indexes: number[];
    /** The position in `refs` each entry of `indexes` came from. */
    readonly refIndexes: number[];
    /** The positions in `refs` that nothing matched, ascending. */
    readonly missing: number[];
}

/**
 * `matchProfileIndexes` over the whole set, and when a pick has gone, over the survivors as
 * a group again — so what is built still obeys the one-claim-per-ref rule that makes the
 * group match meaningful. Several picks per feature are the norm (a hole pattern's regions,
 * a loft's sections), and losing one should cost the user that region, not the whole feature.
 *
 * Finding out WHICH pick went is the delicate part. Asking a ref on its own is not enough:
 * a free face handed to one ref may be the one another pick owns, and a lone leftover face
 * carries no evidence at all — `claimFreeFace` refuses to claim one on geometry alone. The
 * probe therefore assigns faces in order of how well each ref is identified: the refs the
 * sketch's own entity ids still pin down claim their faces first, and only what is left is
 * offered to the rest. A ref that then has no face left is the one that went, and `missing`
 * comes back ascending so a caller can count on the order matching the feature's own list.
 *
 * A ref that matches no face is the only thing reported missing. Two picks naming ONE face
 * never reach this probe: `lockExactMatches` refuses the second as ambiguous while the whole
 * set is still matched together, so the honest answer for a duplicated pick is the group's
 * own error, not a built region plus a pick called lost. Nothing matching at all is likewise
 * an error, not an empty result: a feature with no input left has nothing to build.
 */
export function matchProfilesTolerant(
    faces: IFace[],
    refs: readonly ProfileRef[],
    entities?: (number[] | undefined)[],
    allow?: (refIndex: number, faceIndex: number) => boolean,
): Result<MatchedProfiles> {
    const whole = matchProfileIndexes(faces, [...refs], entities, allow);
    if (whole.isOk) {
        return Result.ok({
            indexes: whole.value,
            refIndexes: refs.map((_, index) => index),
            missing: [],
        });
    }
    if (whole.error === PROFILE_AMBIGUOUS) return Result.err(PROFILE_AMBIGUOUS);

    const taken = new Set<number>();
    const survivors: number[] = [];
    const missing: number[] = [];
    for (const refIndex of probeOrder(refs, entities)) {
        const claimed = claimFreeFace(faces, entities, refs[refIndex], taken, allow);
        if (claimed === "ambiguous") return Result.err(PROFILE_AMBIGUOUS);
        if (claimed === undefined) {
            missing.push(refIndex);
            continue;
        }
        taken.add(claimed);
        survivors.push(refIndex);
    }
    if (survivors.length === 0) return Result.err(PROFILE_NOT_FOUND);
    const group = matchProfileIndexes(
        faces,
        survivors.map((index) => refs[index]),
        entities,
        allow,
    );
    if (!group.isOk) return Result.err(group.error);
    return Result.ok({
        indexes: group.value,
        refIndexes: survivors,
        missing: missing.sort((a, b) => a - b),
    });
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
        const candidates = entitySetMatches(entities, ref, (index) => !taken.has(index)).map((index) => ({
            index,
            score: regionScore(faces[index], ref),
        }));
        if (candidates.length === 0) {
            remaining.push(refIndex);
            continue;
        }
        candidates.sort((a, b) => a.score - b.score);
        const [best, second] = candidates;
        if (second !== undefined && second.score - best.score <= MATCH_TOLERANCE) {
            return Result.err(PROFILE_AMBIGUOUS);
        }
        taken.add(best.index);
        indexes[refIndex] = best.index;
    }
    return Result.ok(remaining);
}

/**
 * The positions of the faces bounded by exactly this entity set, in face order — a region's
 * identity wherever it carries one. `eligible` narrows the candidates (phase 0 excludes the
 * faces already taken; the probe's ordering asks about the whole list). Empty for a ref with
 * no entity set, or when no face carries it.
 */
export function entitySetMatches(
    entities: readonly (number[] | undefined)[],
    ref: Pick<ProfileRef, "entities">,
    eligible?: (index: number) => boolean,
): number[] {
    if (ref.entities === undefined) return [];
    const matches: number[] = [];
    for (const [index, set] of entities.entries()) {
        if (set === undefined || !sameEntitySet(set, ref.entities)) continue;
        if (eligible !== undefined && !eligible(index)) continue;
        matches.push(index);
    }
    return matches;
}

/** Two entity-id sets are equal when their sorted unique contents are. */
export function sameEntitySet(a: readonly number[], b: readonly number[]): boolean {
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
            return Result.err(PROFILE_AMBIGUOUS);
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
    allow: ((refIndex: number, faceIndex: number) => boolean) | undefined,
    lone: LoneCandidate,
): number | undefined {
    const scored: { index: number; score: number }[] = [];
    for (const [index, face] of faces.entries()) {
        if (taken.has(index)) continue;
        if (allow !== undefined && !allow(refIndex, index)) continue;
        const score = profileScore(face, refs[refIndex]);
        if (Number.isFinite(score)) scored.push({ index, score });
    }
    return pickClearWinner(scored, refs[refIndex].edges.length, lone);
}

/**
 * The winning candidate index, undefined when nothing matches, -1 when ambiguous.
 * Exact hits (within tolerance) win outright — several are ambiguous; without one,
 * the best score must be at least 50% better than the runner-up. A candidate that is
 * the only one left has no runner-up to beat, so `lone` decides whether it counts as a
 * winner at all (see `LoneCandidate`).
 */
function pickClearWinner(
    scored: { index: number; score: number }[],
    edgeCount: number,
    lone: LoneCandidate,
): number | undefined {
    if (scored.length === 0) return undefined;
    const exact = scored.filter((x) => x.score <= MATCH_TOLERANCE * edgeCount);
    if (exact.length > 1) return -1;
    if (exact.length === 1) return exact[0].index;
    scored.sort((a, b) => a.score - b.score);
    const [best, second] = scored;
    if (second === undefined) return lone === "accept" ? best.index : undefined;
    if (second.score > 1.5 * best.score + MATCH_TOLERANCE * edgeCount) {
        return best.index;
    }
    return -1;
}

/** Refs the entity ids still identify first, the rest in their stored order. */
function probeOrder(
    profiles: readonly ProfileRef[],
    entities: (number[] | undefined)[] | undefined,
): number[] {
    const locked: number[] = [];
    const rest: number[] = [];
    profiles.forEach((ref, index) => {
        (entitySetMatches(entities ?? [], ref).length > 0 ? locked : rest).push(index);
    });
    return [...locked, ...rest];
}

/**
 * The face this ref claims out of the ones nobody has taken, or undefined when there is
 * none it can call its own. Returning "ambiguous" is the caller's cue to give up rather
 * than pick one of two equally good faces.
 *
 * The probe runs on the free faces alone, which is what makes a stale ref honest: a ref
 * whose region is gone has no free face left to be offered, instead of being handed one
 * that another pick is about to claim.
 *
 * The lone leftover is deliberately REJECTED here (`"reject"`). With nothing to compare
 * against, "closest" is not evidence, and accepting it is exactly how a stale pick gets
 * handed a region it does not own. Identity and an exact hit still claim it — those stand
 * on their own rather than on a comparison.
 */
function claimFreeFace(
    all: IFace[],
    entities: (number[] | undefined)[] | undefined,
    ref: ProfileRef,
    taken: Set<number>,
    allow?: (refIndex: number, faceIndex: number) => boolean,
): number | "ambiguous" | undefined {
    const free: number[] = [];
    for (let index = 0; index < all.length; index++) if (!taken.has(index)) free.push(index);
    // The faces are re-indexed to the free list, so an `allow` written against the full
    // array has to be read back through `free` (and this call has exactly one ref).
    const freeAllow =
        allow === undefined ? undefined : (_ref: number, faceIndex: number) => allow(0, free[faceIndex]);
    const alone = matchIndexes(
        free.map((index) => all[index]),
        [ref],
        entities === undefined ? undefined : free.map((index) => entities[index]),
        freeAllow,
        "reject",
    );
    if (!alone.isOk) return alone.error === PROFILE_AMBIGUOUS ? "ambiguous" : undefined;
    return free[alone.value[0]];
}
