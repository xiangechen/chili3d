// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type DimensionLabel,
    type IView,
    LENGTH_UNITS,
    type ParameterValue,
    Plane,
    Precision,
    Result,
    resolveUnitSpec,
    type Scope,
    type UnitSpec,
    XYZ,
} from "@chili3d/core";
import { ConstraintKind } from "../../lib/garlic";
import type { EdgeRef } from "../features/edgeRef";

export { ConstraintKind };

/** Screen-pixel line width of sketch geometry (entity edges, in and out of the editor). */
export const SKETCH_EDGE_LINE_WIDTH = 2;

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
    /**
     * Construction geometry: a constraint/snap/drag target like any other entity,
     * but excluded from the shape and therefore from profile building — the
     * native-entity counterpart of a "reference"-role external ref. Emitted only
     * when true, so documents without construction geometry round-trip unchanged.
     */
    construction?: boolean;
}

/**
 * line: pointIndex 0 = start, 1 = end; circle: pointIndex 0 = center;
 * arc: pointIndex 0 = center, 1 = start, 2 = end.
 */
export interface SketchPointRef {
    entityId: number;
    pointIndex: number;
}

/** Addressable points per entity type (the `pointIndex` layout of `SketchPointRef`). */
const ENTITY_POINT_COUNTS: Record<SketchEntityType, number> = { circle: 1, line: 2, arc: 3 };

/** Number of point refs an entity of `type` exposes (`pointIndex` runs 0..n−1). */
export function entityPointCount(type: SketchEntityType): number {
    return ENTITY_POINT_COUNTS[type];
}

export interface SketchConstraintData {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    /**
     * A literal in solver-storage units, or an expression written in display units
     * that resolves against the document's parameters (`resolveDatumSource`).
     */
    datum?: ParameterValue;
    /** Datum values for multi-datum kinds (Fix = [x, y]); mutually exclusive with `datum`. */
    datums?: ParameterValue[];
    /**
     * How a radius datum reads: `radius` (absent) or `diameter`. Rides on the constraint
     * rather than on the label anchor because the *solver* is what has to apply the
     * conversion — garlic has no diameter constraint, so the reading is twice the datum
     * it drives, and only this record knows which reading the user wrote.
     */
    display?: RadiusDisplay;
}

/**
 * The arc's structural PointOnArc (all refs on the arc itself) is part of the entity,
 * not a user constraint — it gets no badge and no row in the constraint list, and
 * deleting it would break the arc geometry.
 */
export function isStructuralConstraint(constraint: SketchConstraintData): boolean {
    return (
        constraint.kind === ConstraintKind.PointOnArc &&
        constraint.refs.every((r) => r.entityId === constraint.refs[0].entityId)
    );
}

/**
 * The unit a dimension of `kind` measures — what an expression driving it must
 * resolve to, and what `toDatumSource`/`resolveDatumSource` convert between.
 */
export function datumUnitSpec(kind: ConstraintKind): UnitSpec {
    return kind === ConstraintKind.Angle ? ANGLE_UNITS : LENGTH_UNITS;
}

/**
 * Datum value shown in the UI: angles store the signed sweep (the sign picks the
 * side of the first line) and display its magnitude in degrees, point-line
 * distances flip sign (UI: positive = left of the line direction; garlic stores
 * the negated signed distance), and a diameter reads as twice the radius garlic
 * holds — everything else as stored.
 */
export function toDisplayDatum(
    kind: ConstraintKind,
    value: number,
    display: RadiusDisplay = "radius",
): number {
    if (kind === ConstraintKind.Angle) return (Math.abs(value) * 180) / Math.PI;
    if (kind === ConstraintKind.P2LDistance) return -value;
    if (kind === ConstraintKind.Radius && display === "diameter") return value * 2;
    return value;
}

/**
 * Datum value for the solver: inverse of `toDisplayDatum`. For angles this yields
 * the magnitude in radians — the solver re-attaches the side sign before solving
 * (`SketchSolver.syncAngleDatumSide`) — and for a diameter half the reading, since
 * the constraint underneath is the radius.
 */
export function toStorageDatum(
    kind: ConstraintKind,
    value: number,
    display: RadiusDisplay = "radius",
): number {
    if (kind === ConstraintKind.Angle) return (value * Math.PI) / 180;
    if (kind === ConstraintKind.P2LDistance) return -value;
    if (kind === ConstraintKind.Radius && display === "diameter") return value / 2;
    return value;
}

/**
 * The user's input as stored: a literal is converted into storage units right away,
 * an expression is kept verbatim — it is written in display units, and converting it
 * before it resolves would mean re-parsing the conversion on every rebuild.
 */
export function toDatumSource(
    kind: ConstraintKind,
    input: ParameterValue,
    display: RadiusDisplay = "radius",
): ParameterValue {
    return typeof input === "number" ? toStorageDatum(kind, input, display) : input;
}

/**
 * A stored datum as the number the solver takes: a literal is already in storage
 * units, an expression resolves against `scope` (in display units, checked against
 * the kind's unit) and is converted afterwards. The conversion is the same one the
 * literal path takes, so an expression and a literal of the same reading agree.
 */
export function resolveDatumSource(
    kind: ConstraintKind,
    source: ParameterValue,
    scope: Scope,
    display: RadiusDisplay = "radius",
): Result<number> {
    if (typeof source === "number") return Result.ok(source);
    const resolved = resolveUnitSpec(source, scope, datumUnitSpec(kind));
    if (!resolved.isOk) return Result.err(resolved.error);
    return Result.ok(toStorageDatum(kind, resolved.value, display));
}

// The label frame is the planar layout's own input, so it lives beside that layout in
// core; re-exported here because the anchors below are part of the persisted SketchData.
export type { DimensionLabel };

/**
 * How a radius reads: as the radius itself, or as the diameter (Ø) over the same datum.
 * The solver has no diameter constraint — a diameter is a *reading* of a radius, so the
 * stored datum stays r and only what the user sees and types is doubled.
 */
export type RadiusDisplay = "radius" | "diameter";

/**
 * Label vector from the circle center (Radius) or the angle vertex (Angle). Where the
 * label sits is all the anchor holds: how the datum *reads* is the constraint's own
 * (`SketchConstraintData.display`), so dragging the label cannot turn a Ø back into an R.
 */
export type DimensionAnchor =
    /** A label in the measured line's frame — the linear distance kinds. */
    | ({ readonly kind: "offset" } & DimensionLabel)
    | { readonly kind: "vector"; readonly dx: number; readonly dy: number };

/** The reading a radius constraint asks for; anything but an explicit `diameter` is a radius. */
export function radiusDisplayOf(constraint: SketchConstraintData | undefined): RadiusDisplay {
    if (constraint?.kind !== ConstraintKind.Radius) return "radius";
    return constraint.display ?? "radius";
}

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
 * The sketch's own entities that participate in profile building: every
 * non-construction entity. Construction entities stay constraint/snap targets in
 * the solver but never enter `generateShape`, so a region they help bound does
 * not close into a profile — the same rule reference-role external refs follow.
 */
export function profileEntities(data: SketchData): SketchEntityData[] {
    return data.entities.filter((entity) => entity.construction !== true);
}

/**
 * Entity ids parallel to the edges `SketchNode.generateShape` emits: the sketch's
 * own non-construction entities first, then the profile-role external refs.
 * `sketchProfiles` maps the kernel's source edge indexes through this list on the
 * crossing path.
 */
export function shapeEntityIds(data: SketchData): number[] {
    return [
        ...profileEntities(data).map((entity) => entity.id),
        ...profileExternalRefs(data).map((r) => r.entityId),
    ];
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
 * Raw counter-clockwise sweep of an arc entity's params [cx, cy, sx, sy, ex, ey],
 * un-normalized, in (−2π, 2π): zero when start and end share a ray, negative when
 * the end ray sits clockwise of the start ray (a near-full-circle arc).
 * `arcAngles` normalizes this into (0, 2π].
 */
export function rawArcSweep(params: number[]): number {
    const [cx, cy, sx, sy, ex, ey] = params;
    return (Math.atan2(ey - cy, ex - cx) - Math.atan2(sy - cy, sx - cx)) % (Math.PI * 2);
}

/**
 * Start angle and counter-clockwise sweep (normalized to (0, 2π]) of an arc
 * entity's params [cx, cy, sx, sy, ex, ey]; the end point only fixes the angle,
 * the radius is always ‖s−c‖.
 */
export function arcAngles(params: number[]): [number, number] {
    const [cx, cy, sx, sy] = params;
    const a0 = Math.atan2(sy - cy, sx - cx);
    const sweep = rawArcSweep(params);
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

/**
 * Whether two param layouts of the same type describe the same geometry.
 *
 * The line is the awkward one: its params are not ordered, so a line reflected or
 * offset into the opposite direction comes back with its endpoints swapped and reads
 * as a different line until they are compared as a pair. An arc's are ordered — the
 * sweep is directed — so they must match in place; a circle's radius counts as much
 * as its center.
 *
 * The mirror uses it to leave out a copy that is already in the sketch, and the
 * offset to refuse one that would land on existing geometry: an overlapping pair
 * pushes profile building onto the kernel path (`needsKernelSplit`).
 */
export function sameEntityGeometry(
    type: SketchEntityType,
    first: readonly number[],
    otherType: SketchEntityType,
    second: readonly number[],
    tolerance: number,
): boolean {
    // Different kinds lay their params out differently: a line's four slots read against an
    // arc's six happen to line up wherever the numbers agree, matching shapes that are not.
    if (type !== otherType) return false;
    const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
    const nearPoint = (p: readonly number[], q: readonly number[]) => near(p[0], q[0]) && near(p[1], q[1]);
    if (type === "line") {
        return (
            (nearPoint(first, second) && nearPoint(first.slice(2), second.slice(2))) ||
            (nearPoint(first, second.slice(2)) && nearPoint(first.slice(2), second))
        );
    }
    if (type === "circle") return nearPoint(first, second) && near(first[2], second[2]);
    return first.every((value, index) => near(value, second[index]));
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
 *
 * NOTE: the on-plane measure explodes like 1/cos(grazing) as the view turns
 * edge-on to the plane. For screen-constant graphics (annotation text, arrows,
 * pick tolerances) use `viewPixelSize` instead.
 */
export function worldPerPixel(view: IView, plane: Plane, x: number, y: number): number | undefined {
    const p0 = plane.intersectRay(view.rayAt(x, y));
    const p1 = plane.intersectRay(view.rayAt(x + 1, y));
    if (p0 === undefined || p1 === undefined) return undefined;
    const size = p0.distanceTo(p1);
    return size < 1e-12 ? undefined : size;
}

/**
 * World units per screen pixel at `point`, measured on the plane perpendicular to
 * the center ray through that point. Unlike `worldPerPixel` on the sketch plane
 * this stays bounded at any view angle — it depends only on the camera and the
 * depth of `point` — so screen-sized graphics foreshorten naturally with the
 * tilted sketch instead of ballooning as the view turns edge-on.
 */
export function viewPixelSize(view: IView, point: XYZ): number | undefined {
    const cx = view.width / 2;
    const cy = view.height / 2;
    // the center ray, not view.direction(): the measure must come from the same
    // ray family it samples (the two agree on a real camera)
    const direction = view.rayAt(cx, cy).direction;
    let xvec = direction.cross(view.up());
    if (xvec.lengthSq() < 1e-12) {
        // looking straight along the up axis — pick any perpendicular
        xvec = direction.cross(Math.abs(direction.dot(XYZ.unitX)) < 0.9 ? XYZ.unitX : XYZ.unitY);
    }
    const facing = new Plane({ origin: point, normal: direction, xvec });
    return worldPerPixel(view, facing, cx, cy);
}
