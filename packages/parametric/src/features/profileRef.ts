// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IEdge,
    type IFace,
    type IShape,
    type ISubShape,
    Result,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import { bestEdgeScore, captureEdgeRef, type EdgeRef, MATCH_TOLERANCE, type Vec3 } from "./edgeRef";

/**
 * A geometric fingerprint of a sketch profile (one closed loop): the fingerprints of
 * its outer-boundary edges, plus region-level identity (`center`/`area`). Sketch faces
 * have no kernel-stable ids (they are derived by `sketchProfiles`, not stored), so the
 * edge fingerprints are the primary identity — like `EdgeRef`, they match exactly while
 * the sketch is unchanged and re-match by proximity after edits. Only the outer wire is
 * fingerprinted: a loop drawn inside the profile later becomes a hole of its face
 * (even-odd semantics), which must not change the profile's identity.
 *
 * On crossing sketches, `entities` is the primary identity instead: the sorted ids of
 * the sketch entities bounding the region (endpoint drags never change entity ids,
 * while neighboring regions share complementary segments of the same entities, which
 * makes their geometric fingerprints near-identical). Regions bounded by the same
 * entity set (e.g. the lens regions of two crossing circles) are told apart by the
 * `center`/`area` region fingerprint, which is also the fallback when no candidate
 * carries the ref's entity set (the crossing pattern changed). Refs serialized before
 * these fields existed keep the strict edge-count behavior. See `matchProfileIndexes`.
 */
export interface ProfileRef {
    readonly edges: EdgeRef[];
    readonly center?: Vec3;
    readonly area?: number;
    /** Sorted ids of the sketch entities bounding the region (crossing sketches only). */
    readonly entities?: number[];
    /**
     * Identity assigned by the owning parametric feature chain — set for press-pull refs captured
     * from a parametric body's face, absent for sketch-side refs and pre-id documents. Face ids
     * survive rebuilds: a face split by a later cut shares one id across its pieces, and a face
     * MERGED from several faces combines their ids into a compound (`combineIds`), so an id hit
     * (`idsOverlap`) adopts every piece of a later re-split as well as a re-merge of the pieces —
     * mirroring EdgeRef's whole-span adoption. A ref captured from ONE piece of an already split
     * face narrows to that piece instead (`matchSourceFaceIndexes` in extrude.ts).
     */
    readonly id?: string;
    /**
     * `splitPiece` records that the id was already shared by several faces at capture
     * time — a boolean had split the original face and the pick is just one piece.
     * `matchSourceFaceIndexes` uses it to never widen such a ref to the whole span:
     * a stale fingerprint resolves to the clear nearest piece or fails "Face match is
     * ambiguous after rebuild". Absent on older documents, where refs keep the
     * whole-span adoption.
     */
    readonly splitPiece?: boolean;
    /**
     * Outward normal of the picked solid face — captured ONLY for source-face refs
     * (press-pull): a planar face's outward normal survives the rigid moves parameter
     * edits cause, so `profileScore` rejects a candidate facing more than 60° away
     * (a groove's down-facing ceiling vs its up-facing floor and its walls, which tie
     * geometrically once the ceiling is consumed). Sketch-side refs deliberately lack
     * it: a solver-mirrored wire rebuilds the region face with the flipped
     * orientation, and the gate would reject the legitimate match.
     */
    readonly normal?: Vec3;
}

/** Region faces of the crossing path → their bounding sketch entity ids. */
const profileEntities = new WeakMap<IFace, number[]>();

/**
 * Records the entity-id set of a crossing-path region face. `sketchProfiles` returns
 * the very face objects the profile mesh is built from, and mesh ranges wrap them as
 * sub-shapes whose `parent` chain reaches the registered face, so a WeakMap attaches
 * the identity without changing any call site.
 */
export function registerProfileEntities(face: IFace, entities: number[]): void {
    profileEntities.set(face, entities);
}

/** The entity set registered for `face` or an ancestor in its sub-shape parent chain. */
function registeredEntities(face: IFace): number[] | undefined {
    let current: IShape = face;
    for (let depth = 0; depth < 4; depth++) {
        const entities = profileEntities.get(current as IFace);
        if (entities !== undefined) return entities;
        const parent = (current as Partial<ISubShape>).parent;
        if (parent === undefined) return undefined;
        current = parent;
    }
    return undefined;
}

/** The entity-id set registered for `face` (or an ancestor), when `sketchProfiles` attached one. */
export function profileEntityIds(face: IFace): number[] | undefined {
    return registeredEntities(face);
}

/**
 * Profile faces → the entity id each boundary edge was generated from, parallel to
 * the face's `findSubShapes(ShapeTypes.edge)` order (undefined entries where the
 * attribution failed). Entity ids survive wire re-enumeration — a mirrored or
 * rewound profile permutes the edge order — so sweep features seed edge ids from
 * these instead of positional ordinals (see `profileEdgeSeeds`).
 */
const profileEdgeEntities = new WeakMap<IFace, (number | undefined)[]>();

/** Records the per-edge entity attribution of a profile face (see `profileEdgeEntities`). */
export function registerProfileEdgeEntities(face: IFace, entities: (number | undefined)[]): void {
    profileEdgeEntities.set(face, entities);
}

/** The per-edge entity ids registered for `face`, when `sketchProfiles` attached them. */
export function profileEdgeEntityIds(face: IFace): (number | undefined)[] | undefined {
    return profileEdgeEntities.get(face);
}

export function captureProfileRef(
    face: IFace,
    id?: string,
    splitPiece?: boolean,
    captureNormal = false,
): ProfileRef {
    const edges = boundaryEdges(face).map((edge) => captureEdgeRef(edge));
    const entities = registeredEntities(face);
    const ref: ProfileRef = {
        edges,
        ...captureRegionFingerprint(face),
        ...(id !== undefined ? { id } : {}),
        // Set only when true: absent keeps the serialized shape of older refs.
        ...(splitPiece === true ? { splitPiece: true } : {}),
        ...(entities !== undefined ? { entities } : {}),
    };
    if (captureNormal) {
        const normal = face.normal(0, 0)[1].normalize();
        if (normal !== undefined) return { ...ref, normal: vec3(normal) };
    }
    return ref;
}

/** Edges of the face's outer wire — the profile's identity; hole wires are incidental. */
function boundaryEdges(face: IFace): IEdge[] {
    return face.outerWire().findSubShapes(ShapeTypes.edge) as IEdge[];
}

/**
 * Re-matches stored profile refs against the faces of a rebuilt sketch, returning
 * positions in the given face array (the combined `[...outer, ...inner]` profile
 * list). `entities` carries the entity-id sets of crossing-path faces (parallel to
 * `faces`, undefined entries on the connectivity path). Matching runs in three phases:
 * 0. refs carrying an entity set claim the faces bounded by the same sketch entities
 *    (geometric fingerprints cannot tell adjacent regions of a crossing sketch apart —
 *    they share complementary segments of the same entities). Several candidates with
 *    the same set (e.g. lens regions of two crossing circles) are tiebroken by the
 *    region fingerprint; a ref without any entity-set candidate falls through (the
 *    crossing pattern may have changed);
 * 1. exact geometric hits (within tolerance) lock in first — unmoved profiles are
 *    claimed before moved ones compete for the leftovers, so a moved circle cannot
 *    lose against identical circles that are still in place. Several exact faces for
 *    one ref, or two refs claiming the same face, are ambiguous;
 * 2. moved profiles re-match geometrically among the remaining faces: the closest face
 *    is accepted only when clearly closer than every other (same rule as `EdgeRef`
 *    moved geometry). Faces are scored jointly: a candidate's score is the sum of its
 *    per-edge `bestEdgeScore`s.
 * `allow` restricts the geometric phases (1-2) to eligible (ref, face) pairs — the
 * press-pull source matcher uses it to keep refs whose tracked id died away from
 * faces that carry a live id of their own. Phase 0 is identity-based already and
 * ignores it.
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
 * Sum of the ref's per-edge `bestEdgeScore`s; falls back to `regionScore` when the
 * boundary re-split into a different edge count (crossing sketches) or the curve
 * kinds changed. Also the scorer of the press-pull id-hit narrowing (see
 * `matchSourceFaceIndexes` in extrude.ts). A ref carrying an outward `normal`
 * (source-face picks) rejects candidates facing away before any geometry is scored.
 */
export function profileScore(face: IFace, ref: ProfileRef): number {
    if (ref.normal !== undefined && !normalsAgree(face.normal(0, 0)[1].normalize(), ref.normal)) {
        return Infinity;
    }
    const edges = boundaryEdges(face);
    if (edges.length === ref.edges.length) {
        let score = 0;
        for (const edgeRef of ref.edges) {
            score += bestEdgeScore(edges, edgeRef);
        }
        if (Number.isFinite(score)) return score;
    }
    return regionScore(face, ref);
}

/**
 * Orientation slack for the `normal` gate: the outward normal of a planar face
 * survives rigid moves exactly, so 60° (dot 0.5) never rejects a moved face, while
 * the perpendicular walls and the opposite floor of a consumed groove are rejected.
 * Draft-style edits tilt well below 60°.
 */
const NORMAL_MATCH_DOT = 0.5;

function normalsAgree(candidate: XYZ | undefined, normal: Vec3): boolean {
    if (candidate === undefined) return false;
    return candidate.x * normal.x + candidate.y * normal.y + candidate.z * normal.z >= NORMAL_MATCH_DOT;
}

/**
 * The region fingerprint shared by profile matching, profile-seed ordering and
 * face history completion: bbox center + area. Captured once per face — both
 * queries are kernel calls.
 */
export function captureRegionFingerprint(face: IFace): { center: Vec3; area: number } {
    return { center: vec3(BoundingBox.center(face.boundingBox())), area: face.area() };
}

/**
 * Region similarity: center drift + area drift normalized by the profile's
 * characteristic length. Beyond twice that length the candidate is a different
 * region, not a moved one — Infinity, so a sole leftover face cannot silently claim
 * the ref. A ref without a region fingerprint (legacy documents) scores Infinity.
 */
function regionScore(face: IFace, ref: ProfileRef): number {
    if (ref.center === undefined || ref.area === undefined || ref.area <= 0) return Infinity;
    const length = Math.sqrt(ref.area);
    const region = captureRegionFingerprint(face);
    const score = distance(region.center, ref.center) + Math.abs(region.area - ref.area) / length;
    return score <= 2 * length ? score : Infinity;
}

function vec3(xyz: XYZ): Vec3 {
    return { x: xyz.x, y: xyz.y, z: xyz.z };
}

function distance(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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
