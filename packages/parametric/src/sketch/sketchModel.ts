// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IView, type Plane, Precision, type XYZ } from "@chili3d/core";
import { ConstraintKind } from "../../lib/garlic";

export { ConstraintKind };

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

export interface SketchData {
    entities: SketchEntityData[];
    constraints: SketchConstraintData[];
    /** Datum label positions chosen by the user; absent when never placed. */
    anchors?: SketchDimensionAnchor[];
}

export function emptySketchData(): SketchData {
    return { entities: [], constraints: [] };
}

export function nextSketchId(items: ReadonlyArray<{ id: number }>): number {
    return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

/**
 * Reserved entity ids for the sketch datum: the origin point and the X/Y axis
 * lines. Real entity ids start at 1 (`nextSketchId`), so negatives never clash.
 * Datum entities live only in the solver — never serialized as entities, never
 * rendered as sketch geometry — but constraints may reference them and are
 * serialized as ordinary `SketchConstraintData`.
 */
export const SKETCH_ORIGIN_ID = -1;
export const SKETCH_X_AXIS_ID = -2;
export const SKETCH_Y_AXIS_ID = -3;

export function isDatumEntityId(id: number): boolean {
    return id === SKETCH_ORIGIN_ID || id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID;
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
