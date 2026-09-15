// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IView, type Plane, Precision, type XYZ } from "@chili3d/core";
import { ConstraintKind } from "../../lib/garlic";
import type { EdgeRef } from "../features/edgeRef";

export { ConstraintKind };

/** Screen-pixel line width of sketch geometry (entity edges, in and out of the editor). */
export const SKETCH_EDGE_LINE_WIDTH = 2;

/**
 * Shared tolerance for incidence residuals (a point left off its line/circle after a coarse
 * solve). The solver's repair pass uses it; profileBuilder's endpoint-on-interior probe matches
 * it so the two layers agree on what "on the edge" means.
 */
export const INCIDENCE_TOLERANCE = 1e-4;

export type SketchEntityType = "line" | "circle" | "arc";

/**
 * line: params = [x1, y1, x2, y2]; circle: params = [cx, cy, r];
 * arc: params = [cx, cy, sx, sy, ex, ey] (center, start, end; radius = ‖s−c‖,
 * counter-clockwise sweep from start to end) — all in sketch (u, v) coordinates.
 */
export interface SketchEntityData {
    id: number;
    type: SketchEntityType;
    params: number[];
}

/**
 * line: pointIndex 0 = start, 1 = end; circle: pointIndex 0 = center;
 * arc: pointIndex 0 = center, 1 = start, 2 = end.
 */
export interface SketchPointRef {
    entityId: number;
    pointIndex: number;
}

export interface SketchConstraintData {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    datum?: number;
    /** Datum values for multi-datum kinds (Fix = [x, y]); mutually exclusive with `datum`. */
    datums?: number[];
}

/** Where the label of a datum constraint is anchored, relative to its references. */
export type DimensionAnchor =
    /** Signed perpendicular offset from the measured segment (P2PDistance). */
    | { readonly kind: "offset"; readonly offset: number }
    /** Label vector from the circle center (Radius). */
    | { readonly kind: "vector"; readonly dx: number; readonly dy: number };

/** Datum label anchor bound to a constraint id (ids are stable across sessions). */
export interface SketchDimensionAnchor {
    id: number;
    anchor: DimensionAnchor;
}

/**
 * An edge of another node projected onto the sketch plane as construction
 * geometry. The edge is re-matched on the source node's current shape via the
 * stored `EdgeRef` fingerprint (exact `edgeId` hit when the source tracks
 * edges); the last successfully resolved geometry is kept in `snapshot` (sketch
 * UV params in the layout of `type`), so constraints keep solving against stale
 * geometry when resolution fails (`dangling`). Constraints reference external
 * entities as ordinary `{ entityId, pointIndex }` refs — no format change.
 */
export interface ExternalRefData {
    /** Reserved negative id, allocated from `FIRST_EXTERNAL_ENTITY_ID` downward. */
    entityId: number;
    /** Source node (the part) the edge lives on. */
    nodeId: string;
    /** Edge fingerprint, with the kernel edgeId when the source provides one. */
    edge: EdgeRef;
    /** "profile" externals join profile building; "reference" ones never do. */
    role: "reference" | "profile";
    /**
     * Set by an explicit profile-role choice: the profile role option when
     * projecting edges, and every `sketch.toggleExternal` flip. Auto-derivation
     * never overrides a pinned ref (see `syncExternalRoles`). An explicit REFERENCE
     * pick (the default role option) stays unpinned — a promotable default: when a
     * constraint later references the edge, derivation promotes it to profile.
     * That is deliberate: reference-role edges never enter `generateShape`, so
     * promotion is the only way a referenced edge can close loops into faces.
     */
    pinned?: boolean;
    /** Last resolved params in sketch UV (line/circle/arc layout matching `type`). */
    snapshot: number[];
    /** Resolved sketch entity type. */
    type: SketchEntityType;
    /** Resolution failed at the last rebuild; `snapshot` is stale (but still builds profiles). */
    dangling?: boolean;
}

export interface SketchData {
    entities: SketchEntityData[];
    constraints: SketchConstraintData[];
    /** Datum label positions chosen by the user; absent when never placed. */
    anchors?: SketchDimensionAnchor[];
    /** Edges of other nodes usable as constraint targets (and optionally profiles). */
    externalRefs?: ExternalRefData[];
    /**
     * Timeline anchor per referenced parametric body (nodeId → feature count when
     * the sketch first referenced it). The sketch editor rolls each such body back
     * to this position for the session (see `computeSketchRollback`), so the plane
     * and external references resolve against the geometry they were captured from
     * and features added later are hidden while editing. Recorded only at capture
     * time (sketch creation on a face, `sketch.projectEdges`), never on the
     * resolution/generateShape path.
     */
    refPositions?: Record<string, number>;
    /**
     * Next real entity id (monotonic, counts up from 1). Entity ids are the primary
     * key of ProfileRef region identity, so a freed id is never reused — a stale
     * fingerprint could otherwise match a geometrically different region. Absent in
     * documents written before the counters; the solver then initializes it from the
     * current max entity id + 1.
     */
    entityIdSeq?: number;
    /**
     * Next external entity id (monotonic, counts down from FIRST_EXTERNAL_ENTITY_ID).
     * Same no-reuse guarantee as `entityIdSeq`; absent in pre-counter documents,
     * where the solver initializes it from the current min external id − 1.
     */
    externalIdSeq?: number;
}

export function emptySketchData(): SketchData {
    return { entities: [], constraints: [] };
}

/**
 * Derives unpinned external-ref roles from the constraints referencing them: a ref
 * any constraint (of any kind, dimensions included) points at is "profile", one no
 * constraint references is "reference". Refs with `pinned` keep their stored role —
 * an explicit user choice. Mutates in place; returns whether any role changed.
 * Applied when SketchData is finalized (solver `toData`, `loadData`), never on the
 * resolution/generateShape path.
 */
export function syncExternalRoles(data: Pick<SketchData, "constraints" | "externalRefs">): boolean {
    const refs = data.externalRefs;
    if (refs === undefined || refs.length === 0) return false;
    const referenced = new Set(data.constraints.flatMap((c) => c.refs.map((r) => r.entityId)));
    let changed = false;
    for (const ref of refs) {
        if (ref.pinned === true) continue;
        const role = referenced.has(ref.entityId) ? "profile" : "reference";
        if (ref.role !== role) {
            ref.role = role;
            changed = true;
        }
    }
    return changed;
}

export function nextSketchId(items: ReadonlyArray<{ id: number }>): number {
    return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

/**
 * Reserved entity ids for the sketch datum: the origin point and the X/Y axis
 * lines. Real entity ids are allocated monotonically from 1 (`entityIdSeq` in the
 * solver, persisted as `SketchData.entityIdSeq`; `nextSketchId` serves constraint
 * ids only), so negatives never clash. Datum entities live only in the solver —
 * never serialized as entities, never rendered as sketch geometry — but
 * constraints may reference them and are serialized as ordinary
 * `SketchConstraintData`.
 */
export const SKETCH_ORIGIN_ID = -1;
export const SKETCH_X_AXIS_ID = -2;
export const SKETCH_Y_AXIS_ID = -3;

export function isDatumEntityId(id: number): boolean {
    return id === SKETCH_ORIGIN_ID || id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID;
}

/**
 * Reserved entity ids for external references start at -100 and count down, so
 * they never collide with the datum ids (-1..-3) or real entity ids (1+). Ids are
 * allocated monotonically downward via `SketchData.externalIdSeq` and never
 * reused (a stale `ProfileRef` entity-id set must not hit a new, unrelated ref).
 * Like the datum, external entities live only in the solver (never serialized as
 * entities); their persistent state is `SketchData.externalRefs`.
 */
export const FIRST_EXTERNAL_ENTITY_ID = -100;

export function isExternalEntityId(id: number): boolean {
    return id <= FIRST_EXTERNAL_ENTITY_ID;
}

/**
 * External refs that participate in profile building: every profile-role ref,
 * including dangling ones — a ref whose source edge is (temporarily) gone keeps
 * contributing its last-known `snapshot`, so the sketch degrades to frozen
 * geometry (drawn red in the editor) instead of failing dependent features with
 * "not closed" errors. A later rebuild that re-matches the edge clears `dangling`
 * and the profile follows the freshened snapshot.
 */
export function profileExternalRefs(data: SketchData): ExternalRefData[] {
    return (data.externalRefs ?? []).filter((ref) => ref.role === "profile");
}

/**
 * Entity ids parallel to the edges `SketchNode.generateShape` emits: the sketch's
 * own entities first, then the profile-role external refs. `sketchProfiles` maps
 * the kernel's source edge indexes through this list on the crossing path.
 */
export function shapeEntityIds(data: SketchData): number[] {
    return [...data.entities.map((entity) => entity.id), ...profileExternalRefs(data).map((r) => r.entityId)];
}

/** Point ref of the sketch origin (0, 0). */
export function originRef(): SketchPointRef {
    return { entityId: SKETCH_ORIGIN_ID, pointIndex: 0 };
}

/** The two point refs addressing a datum axis as a line (pointIndex 0/1). */
export function axisLineRefs(axisId: number): [SketchPointRef, SketchPointRef] {
    return [
        { entityId: axisId, pointIndex: 0 },
        { entityId: axisId, pointIndex: 1 },
    ];
}

/** Fixed (u, v) coordinates of a datum point ref. */
export function datumPoint(ref: SketchPointRef): [number, number] {
    if (ref.entityId === SKETCH_ORIGIN_ID) return [0, 0];
    if (ref.entityId === SKETCH_X_AXIS_ID) return ref.pointIndex === 0 ? [0, 0] : [1, 0];
    if (ref.entityId === SKETCH_Y_AXIS_ID) return ref.pointIndex === 0 ? [0, 0] : [0, 1];
    throw new Error(`Not a datum entity: ${ref.entityId}`);
}

/** Synthetic entity data of a datum axis line, for meshes and type checks. */
export function datumEntityData(id: number): SketchEntityData {
    if (id === SKETCH_X_AXIS_ID) return { id, type: "line", params: [0, 0, 1, 0] };
    if (id === SKETCH_Y_AXIS_ID) return { id, type: "line", params: [0, 0, 0, 1] };
    throw new Error(`Not a datum axis: ${id}`);
}

/** Stable string key of a point ref, for grouping/dedup. */
export function pointRefKey(ref: SketchPointRef): string {
    return `${ref.entityId}:${ref.pointIndex}`;
}

export function cloneSketchData(data: SketchData): SketchData {
    return JSON.parse(JSON.stringify(data)) as SketchData;
}

/**
 * Start angle and counter-clockwise sweep (normalized to (0, 2π]) of an arc
 * entity's params [cx, cy, sx, sy, ex, ey]; the end point only fixes the angle,
 * the radius is always ‖s−c‖.
 */
export function arcAngles(params: number[]): [number, number] {
    const [cx, cy, sx, sy, ex, ey] = params;
    const a0 = Math.atan2(sy - cy, sx - cx);
    const sweep = (Math.atan2(ey - cy, ex - cx) - a0) % (Math.PI * 2);
    return [a0, sweep > Precision.Angle ? sweep : sweep + Math.PI * 2];
}

/** Radius of a circle (params[2]) or arc (‖start−center‖) entity. */
export function entityRadius(entity: SketchEntityData): number {
    if (entity.type === "circle") return entity.params[2];
    if (entity.type === "arc") {
        return Math.hypot(entity.params[2] - entity.params[0], entity.params[3] - entity.params[1]);
    }
    throw new Error(`Entity ${entity.id} has no radius`);
}

/** Sketch (u, v) → world: origin + xvec * u + yvec * v. */
export function toWorld(plane: Plane, u: number, v: number): XYZ {
    return plane.origin.add(plane.xvec.multiply(u)).add(plane.yvec.multiply(v));
}

/**
 * World point → sketch (u, v): project onto the plane, then dot with xvec / yvec.
 */
export function toUV(plane: Plane, point: XYZ): [number, number] {
    const vector = plane.project(point).sub(plane.origin);
    return [vector.dot(plane.xvec), vector.dot(plane.yvec)];
}

/**
 * Sketch-plane units per screen pixel at viewport position (x, y), measured with
 * two rays — exact for both camera types, unlike `worldToScreen` which rounds to
 * whole pixels and collapses small spans at low zoom levels. Undefined when the
 * plane is off-ray or the span collapses.
 */
export function worldPerPixel(view: IView, plane: Plane, x: number, y: number): number | undefined {
    const p0 = plane.intersectRay(view.rayAt(x, y));
    const p1 = plane.intersectRay(view.rayAt(x + 1, y));
    if (p0 === undefined || p1 === undefined) return undefined;
    const size = p0.distanceTo(p1);
    return size < 1e-12 ? undefined : size;
}
