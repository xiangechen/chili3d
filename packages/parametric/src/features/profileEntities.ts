// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IShape, type ISubShape, ShapeTypes } from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { INCIDENCE_TOLERANCE } from "./refGeometry";

/**
 * Which sketch entities a built profile region came from.
 *
 * This is what lets a stored `ProfileRef` identify a region by *content* instead of by
 * position: `ProfileRef.entities` holds the sorted entity ids bounding the region, a
 * stable key that survives endpoint drags and re-splits, where an index would drift as
 * soon as a profile is added or removed.
 *
 * The two edges of the problem:
 * - **Region → entities** (`sourceEntityIds`), on the kernel path, where the splitter
 *   reports the input edge indexes each region came from.
 * - **Region edge → entity** (`attributeFaceEdges`, `registerRegionEdgeEntities`), which
 *   walks the region's own boundary and recovers the originating entity per edge — the
 *   region's edges are new TShapes the splitter cut, so an identity test alone is not
 *   enough and an on-curve probe has to back it up.
 *
 * It also owns the STORAGE: the two `WeakMap`s below hold what was computed, keyed on the
 * face object. They live here, next to the code that fills them, because a registration
 * and its lookup must close over the SAME `WeakMap` instance — splitting them across
 * modules would silently register into one map and read from another, with no compile
 * error to catch it.
 */

/**
 * Makes a missing entity id loud, in the spirit of `reportSilentIdLoss`
 * (features/idDiagnostics.ts): the edge list and the entity-id list are parallel on
 * every healthy path (generateShape builds one edge per entity, then the
 * profile-role external refs), so a miss means the kernel's source report and the
 * sketch have diverged. Silently stuffing undefined into a region's identity set
 * would degrade its ProfileRef to geometric matching only after a serialization
 * round-trip (undefined → null), far from the cause.
 */
export function reportMissingEntityId(sketch: SketchNode, what: string): void {
    console.warn(
        `[chili3d] profile entity loss: ${what} (sketch ${sketch.id}) — the profile identity degrades to geometric matching. Please report this scenario.`,
    );
}

/**
 * Input edge i corresponds to shapeEntityIds[i] (generateShape combines one edge
 * per entity in `data.entities` order, then the profile-role external refs) — map
 * the kernel's source indexes to the entity ids, which survive endpoint drags and
 * re-splits. An index outside the entity list would stuff undefined into the
 * region's identity set: skip it (loudly) instead. An in-range miss was already
 * reported where the lookup dropped it (see splitProfiles).
 */
export function sourceEntityIds(
    sourceIndexes: number[],
    entityIds: readonly (number | undefined)[],
    sketch: SketchNode,
): number[] {
    return sourceIndexes
        .flatMap((index) => {
            if (index < 0 || index >= entityIds.length) {
                reportMissingEntityId(
                    sketch,
                    `the kernel reported source edge ${index}, beyond the ${entityIds.length} entity ids`,
                );
                return [];
            }
            const id = entityIds[index];
            return id === undefined ? [] : [id];
        })
        .sort((a, b) => a - b);
}

/** A region's boundary edges are pieces the splitter cut from its source edges. */
export function registerRegionEdgeEntities(
    face: IFace,
    edges: IEdge[],
    sourceIndexes: number[],
    entityIds: readonly (number | undefined)[],
    sketch: SketchNode,
): void {
    const candidates = sourceIndexes.map((i) => edges[i]);
    registerProfileEdgeEntities(
        face,
        attributeFaceEdges(face, candidates, entityIdByEdge(candidates, entityIds, sourceIndexes, sketch)),
    );
}

/** Candidate edge → entity id lookup for `attributeFaceEdges`. */
function entityIdByEdge(
    candidates: IEdge[],
    entityIds: readonly (number | undefined)[],
    sourceIndexes: number[],
    sketch: SketchNode,
): Map<IEdge, number> {
    const map = new Map<IEdge, number>();
    for (const [k, edge] of candidates.entries()) {
        const index = sourceIndexes[k];
        if (index < 0 || index >= entityIds.length) {
            reportMissingEntityId(
                sketch,
                `the kernel reported source edge ${index}, beyond the ${entityIds.length} entity ids`,
            );
            continue;
        }
        const id = entityIds[index];
        // An in-range miss was already reported where the lookup dropped it (see
        // splitProfiles); the edge keeps the positional seed fallback.
        if (id === undefined) continue;
        map.set(edge, id);
    }
    return map;
}

/**
 * The entity id each boundary edge of `face` was generated from, parallel to the
 * face's edge enumeration: an exact `isSame` hit first (a face shares the TShapes
 * of the edges it was built from; the kernel splitter also keeps untouched edges),
 * then an on-curve probe for split pieces (region edges are new TShapes cut from
 * the input edges). Undefined where neither matches — the seed falls back to the
 * positional ordinal there.
 */
export function attributeFaceEdges(
    face: IFace,
    candidates: IEdge[],
    idByEdge: Map<IEdge, number>,
): (number | undefined)[] {
    let faceEdges: IEdge[];
    try {
        faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        // A mocked face without sub-shape access — no attribution, no seeds.
        return [];
    }
    return faceEdges.map((edge) => {
        const match =
            candidates.find((candidate) => safeIsSame(edge, candidate)) ??
            candidates.find((candidate) => safeLiesOn(edge, candidate));
        return match === undefined ? undefined : idByEdge.get(match);
    });
}

/** `edge.isSame(candidate)`, false when either side cannot be probed (a degenerate or mocked edge). */
function safeIsSame(edge: IEdge, candidate: IEdge): boolean {
    try {
        return edge.isSame(candidate);
    } catch {
        return false;
    }
}

/** `edgeLiesOn(edge, candidate)`, false when either side cannot be probed. */
function safeLiesOn(edge: IEdge, candidate: IEdge): boolean {
    try {
        return edgeLiesOn(edge, candidate);
    } catch {
        return false;
    }
}

/**
 * True when `piece` lies on `whole`'s trimmed curve (start/mid/end within
 * INCIDENCE_TOLERANCE — the solver's incidence-repair scale, so both layers agree
 * on "on the edge"). Probing the trimmed curve also rejects a collinear candidate
 * whose span does not reach the piece.
 */
function edgeLiesOn(piece: IEdge, whole: IEdge): boolean {
    const [t0, t1] = [piece.firstParameter(), piece.lastParameter()];
    return [t0, (t0 + t1) / 2, t1].every(
        (t) => whole.curve.nearestFromPoint(piece.pointAt(t)).distance < INCIDENCE_TOLERANCE,
    );
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

/**
 * How far `profileEntityIds` walks up the sub-shape `parent` chain. One step is what the
 * mesh path needs (`OccSubFaceShape.parent` is the registered face); the rest is slack
 * for any deeper wrapping. The bound is what ends the walk in the pathological case —
 * `parent` is a bare object reference, so only an `undefined` parent stops it naturally
 * and a self-referencing shape would otherwise spin forever.
 */
const MAX_SUB_SHAPE_DEPTH = 4;

/**
 * The entity-id set `sketchProfiles` registered for `face` or for an ancestor in its
 * sub-shape chain: a viewport pick hands over the mesh range's sub-shape wrapper rather
 * than the registered region face, so the lookup walks up (see `MAX_SUB_SHAPE_DEPTH`).
 */
export function profileEntityIds(face: IFace): number[] | undefined {
    let current: IShape = face;
    for (let depth = 0; depth < MAX_SUB_SHAPE_DEPTH; depth++) {
        const entities = profileEntities.get(current as IFace);
        if (entities !== undefined) return entities;
        const parent = (current as Partial<ISubShape>).parent;
        if (parent === undefined) return undefined;
        current = parent;
    }
    return undefined;
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
