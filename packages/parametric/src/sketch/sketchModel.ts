// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IView, Plane, XYZ } from "@chili3d/core";
import { ConstraintKind } from "../../lib/garlic";

export { ConstraintKind };

export type SketchEntityType = "line" | "circle";

/**
 * line: params = [x1, y1, x2, y2]; circle: params = [cx, cy, r] — all in sketch (u, v) coordinates.
 */
export interface SketchEntityData {
    id: number;
    type: SketchEntityType;
    params: number[];
}

/**
 * line: pointIndex 0 = start, 1 = end; circle: pointIndex 0 = center.
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

/** Stable string key of a point ref, for grouping/dedup. */
export function pointRefKey(ref: SketchPointRef): string {
    return `${ref.entityId}:${ref.pointIndex}`;
}

export function cloneSketchData(data: SketchData): SketchData {
    return JSON.parse(JSON.stringify(data)) as SketchData;
}

/**
 * Sketch (u, v) → world: origin + xvec * u + yvec * v.
 */
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
