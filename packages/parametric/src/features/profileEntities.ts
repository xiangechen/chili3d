// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IShape, type ISubShape, ShapeTypes, type XYZ } from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { edgeMidPoint } from "./edgeRef";
import { reportIdentityLoss } from "./idDiagnostics";
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
 * every healthy path (generateShape builds one edge per entity — one per contour
 * segment for a text — then the profile-role external refs, and `shapeEntityIds`
 * repeats a text's id per edge), so a miss means the kernel's source report and the
 * sketch have diverged. Silently stuffing undefined into a region's identity set
 * would degrade its ProfileRef to geometric matching only after a serialization
 * round-trip (undefined → null), far from the cause.
 */
export function reportMissingEntityId(sketch: SketchNode, what: string): void {
    reportIdentityLoss(
        `[chili3d] profile entity loss: ${what} (sketch ${sketch.id}) — the profile identity degrades to geometric matching. Please report this scenario.`,
    );
}

/**
 * Input edge i corresponds to shapeEntityIds[i] (generateShape combines the entities'
 * edges in `data.entities` order — one per entity, one per contour segment for a
 * text — then the profile-role external refs, and `shapeEntityIds` lists the ids per
 * edge the same way) — map the kernel's source indexes to the entity ids, which
 * survive endpoint drags and re-splits. An index outside the entity list would stuff
 * undefined into the region's identity set: skip it (loudly) instead. An in-range
 * miss was already reported where the lookup dropped it (see splitProfiles).
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

/**
 * A region's boundary edges are pieces the splitter cut from its source edges.
 *
 * When the sketch holds an entity that expands to several edges (a text — one edge per
 * contour segment), `suffixes` carries every sketch edge's seed suffix, and a region
 * such an entity borders takes the suffix channel: its pieces of that entity would
 * otherwise all mint the one `ent<id>` seed and `uncontested` would drop them all (see
 * `edgeSeedSuffixes`). Regions without such an edge keep the pure entity-id seeds, so
 * a sketch without text — every older document — is byte-identical.
 */
export function registerRegionEdgeEntities(
    face: IFace,
    edges: IEdge[],
    sourceIndexes: number[],
    entityIds: readonly (number | undefined)[],
    sketch: SketchNode,
    suffixes?: EdgeSeedSuffixes,
): void {
    const candidates = sourceIndexes.map((i) => edges[i]);
    registerProfileEdgeEntities(
        face,
        attributeFaceEdges(face, candidates, entityIdByEdge(candidates, entityIds, sourceIndexes, sketch)),
    );
    if (suffixes === undefined) return;
    const borderedByText = sourceIndexes.some((i) => {
        const id = entityIds[i];
        return id !== undefined && suffixes.textIds.has(id);
    });
    if (borderedByText) {
        registerProfileEdgeSuffixes(face, attributeFaceEdges(face, candidates, suffixes.byEdge));
    }
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
        // splitProfiles); the edge then seeds nothing (see `profileEdgeSeeds`).
        if (id === undefined) continue;
        map.set(edge, id);
    }
    return map;
}

/**
 * What each boundary edge of `face` was generated from, parallel to the face's edge
 * enumeration: an exact `isSame` hit first (a face shares the TShapes of the edges it
 * was built from; the kernel splitter also keeps untouched edges), then an on-curve
 * probe for split pieces (region edges are new TShapes cut from the input edges).
 * Undefined where neither matches — the edge then has no seed. The attributed value is
 * whatever `byEdge` keys the candidates by: an entity id, or a seed suffix when an
 * entity expands to several edges (see `edgeSeedSuffixes`).
 */
export function attributeFaceEdges<T>(
    face: IFace,
    candidates: IEdge[],
    byEdge: Map<IEdge, T>,
): (T | undefined)[] {
    let faceEdges: IEdge[];
    try {
        faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        // A mocked face without sub-shape access — no attribution, no seeds.
        return [];
    }
    return attributeEdges(faceEdges, candidates, (candidate) => byEdge.get(candidate));
}

/**
 * Attributes each edge of `edges` to the candidate it was generated from — the profile-face
 * attribution's matching core (`attributeFaceEdges`). The two probes, in order and both needed:
 * - `isSame` — an identity hit (a rebuilt face or sweep keeps the TShapes of what it was built from);
 * - `edgeLiesOn` — an on-curve probe, for the pieces the kernel CUT: they are new TShapes that lie
 *   on a candidate's trimmed curve without sharing it.
 *
 * The generated-edge attribution of a tracked operation (`attributeSweepEdges`,
 * `attributeCornerEdges`) matches by relation instead — a corner stands a parameter away from its
 * edge, a seam runs parallel to it — so it has its own loop; what the three share is the probe
 * itself (`edgeLiesOn`) and the rule that an ambiguous edge stays unnamed.
 */
export function attributeEdges<T>(
    edges: readonly IEdge[],
    candidates: readonly IEdge[],
    idOf: (candidate: IEdge) => T | undefined,
): (T | undefined)[] {
    return edges.map((edge) => {
        const match =
            candidates.find((candidate) => safeIsSame(edge, candidate)) ??
            candidates.find((candidate) => safeLiesOn(edge, candidate));
        return match === undefined ? undefined : idOf(match);
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
 *
 * Exported for the generated-edge attribution of tracked operations, which probes
 * the same way against the input edges a sweep or fillet produced edges from.
 */
export function edgeLiesOn(piece: IEdge, whole: IEdge): boolean {
    return edgeLiesOnImage(piece, whole, (point) => point);
}

/**
 * `edgeLiesOn` for the SWEEP's image of `whole`: does `piece` lie on the curve `whole`
 * would have if carried back by `unimage`?
 *
 * A sweep carries every profile point through one rigid motion, so the image of `whole` is
 * the set of images of its points — reproduced here by applying the motion's INVERSE to three
 * probes of `piece` (start, mid, end), which beats building a kernel copy of every profile
 * edge. The motion is all that differs between sweeps: a prism translates by its vector, a
 * revolve rotates about its axis.
 */
export function edgeLiesOnImage(piece: IEdge, whole: IEdge, unimage: (point: XYZ) => XYZ): boolean {
    const [t0, t1] = [piece.firstParameter(), piece.lastParameter()];
    return [piece.pointAt(t0), edgeMidPoint(piece), piece.pointAt(t1)].every(
        (point) => whole.curve.nearestFromPoint(unimage(point)).distance < INCIDENCE_TOLERANCE,
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

/**
 * Profile faces → the seed SUFFIX each boundary edge carries, for a profile whose edges
 * a bare entity id cannot tell apart.
 *
 * A rib's band is one case: one chain entity offsets into TWO band edges, one per side, so
 * keying both by that entity would hand two sub-shapes the same seed — and the ids they mint
 * collide, which `uncontested` settles by dropping BOTH (measured: the rib's two top edges came
 * back unnamed, along with everything else derived from them). A suffix can say which side an
 * edge is, which an entity id cannot. A sketch TEXT is the other: one entity expands to one
 * edge per contour segment, so edge k of the entity carries `ent<id>:e<k>`.
 *
 * Preferred over `profileEdgeEntities` when both are registered (`profileEdgeSeeds`).
 */
const edgeSeedSuffixes = new WeakMap<IFace, (string | undefined)[]>();

/**
 * The seed suffix of every edge of a sketch, keyed by the edge object — built only when
 * an entity expands to several edges (a text, one edge per contour segment), which a
 * single `ent<id>` per entity cannot tell apart. The multi-edge entity's edge k carries
 * `ent<id>:e<k>` (k in the order `shapeEntityIds` repeats the id); every other edge
 * carries the plain `ent<id>` the entity channel would have minted, so a face mixing
 * both keeps its non-text seeds byte-identical.
 */
export interface EdgeSeedSuffixes {
    readonly byEdge: Map<IEdge, string>;
    /** Ids of the multi-edge entities; a face borders one of their edges ⇒ it takes the suffix channel. */
    readonly textIds: ReadonlySet<number>;
}

/** Records the per-edge seed suffixes of a profile face (see `edgeSeedSuffixes`). */
export function registerProfileEdgeSuffixes(face: IFace, suffixes: (string | undefined)[]): void {
    edgeSeedSuffixes.set(face, suffixes);
}

/** The per-edge seed suffixes registered for `face`, if any. */
export function profileEdgeSeedSuffixes(face: IFace): (string | undefined)[] | undefined {
    return edgeSeedSuffixes.get(face);
}
