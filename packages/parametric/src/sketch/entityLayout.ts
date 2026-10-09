// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { SketchEntityType } from "./sketchModel";

/**
 * The garlic parameter layout of a sketch entity type — how many params an entity
 * carries, and what each one means.
 *
 * Its own module because two things need it that are not each other: `solver.ts`,
 * which creates the params, and `externalEntities.ts`, which seeds a snapshot into
 * them. `normalizeSnapshot` is here for the same reason — it is the guard that keeps
 * a hand-edited or legacy snapshot from reaching either one short.
 */

/** garlic param kind: an (x, y) coordinate pair, a scalar length/radius, or a dimensionless scalar (rho, t). */
export const PARAM_KIND_COORDINATE = 0;
export const PARAM_KIND_LENGTH = 1;
export const PARAM_KIND_DIMENSIONLESS = 2;

/**
 * garlic param kinds per entity type: line = 2 points, circle = center + radius,
 * arc = 3 points, ellipse = 3 points, ellipseArc = 5 points, conic = 3 points + a
 * dimensionless rho, bezier = its 4 control poles, nurbs = `count`/3 control poles
 * followed by their dimensionless weights (variable length).
 */
export function entityParamKinds(type: SketchEntityType, count?: number): number[] {
    switch (type) {
        case "line":
        case "arc":
        case "ellipse":
        case "ellipseArc":
        case "bezier":
            return new Array(ENTITY_PARAM_COUNTS[type]).fill(PARAM_KIND_COORDINATE);
        case "offsetCurve":
            // no geometry of its own to param: it is read off its source
            return [];
        case "circle":
            return [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_LENGTH];
        case "conic":
            return [
                PARAM_KIND_COORDINATE,
                PARAM_KIND_COORDINATE,
                PARAM_KIND_COORDINATE,
                PARAM_KIND_COORDINATE,
                PARAM_KIND_COORDINATE,
                PARAM_KIND_COORDINATE,
                PARAM_KIND_DIMENSIONLESS,
            ];
        case "nurbs": {
            if (count === undefined || count % 3 !== 0) {
                throw new Error(`A nurbs' param kinds need its pole count, got ${count} params`);
            }
            const poles = count / 3;
            return [
                ...new Array(poles * 2).fill(PARAM_KIND_COORDINATE),
                ...new Array(poles).fill(PARAM_KIND_DIMENSIONLESS),
            ];
        }
    }
}

/** Fixed param counts per entity type (a nurbs' follows its pole count, hence absent). */
const ENTITY_PARAM_COUNTS = {
    // an offset curve lays out its *source's* params, so it has none of its own
    offsetCurve: 0,
    line: 4,
    circle: 3,
    arc: 6,
    ellipse: 6,
    ellipseArc: 10,
    conic: 7,
    bezier: 8,
} as const;

/**
 * Pads/truncates a snapshot to the entity type's param layout. Hand-edited or
 * legacy data can carry a truncated snapshot — normalizing beats throwing from a
 * property-listener path (updateExternalEntity's length guard), seeding garlic
 * with a short param array, or feeding NaN coordinates to shape building. Unknown
 * types and already-matching lengths pass through unchanged (same array identity).
 */
export function normalizeSnapshot(type: SketchEntityType, snapshot: number[]): number[] {
    if (type === "nurbs") return snapshot;
    const count = ENTITY_PARAM_COUNTS[type];
    if (count === undefined || snapshot.length === count) return snapshot;
    return Array.from({ length: count }, (_, index) => snapshot[index] ?? 0);
}

/**
 * A NURBS' params as the solver needs them: three entries per pole — its two coordinates
 * and its weight. A hand-edited or truncated list can carry a partial pole, which no read
 * can make sense of (the pole count is what says where the weights start), so the partial
 * one is dropped; a list that stops before the weights are all there gets the unit weight
 * a plain B-spline has, which is what the tool would have written anyway. The same repair
 * `normalizeSnapshot` does for an external ref.
 */
export function normalizeNurbsParams(params: number[]): number[] {
    // a curve needs two control points; one or none is padded up to a degenerate pair
    // rather than dropped — the document keeps its entity, and the user can see and
    // delete what is wrong with it
    const poles = Math.max(2, Math.floor(params.length / 3));
    const needed = poles * 3;
    const repaired = params.slice(0, needed);
    for (let i = params.length; i < needed; i++) repaired[i] = i >= poles * 2 ? 1 : 0;
    return repaired;
}
