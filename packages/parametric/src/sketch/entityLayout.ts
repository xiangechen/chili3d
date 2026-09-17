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

/** garlic param kind: an (x, y) coordinate pair, or a scalar length/radius. */
export const PARAM_KIND_COORDINATE = 0;
export const PARAM_KIND_LENGTH = 1;

/** garlic param kinds per entity type: line = 2 points, circle = center + radius, arc = 3 points. */
export const ENTITY_PARAM_KINDS: Record<SketchEntityType, number[]> = {
    line: [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE],
    circle: [PARAM_KIND_COORDINATE, PARAM_KIND_COORDINATE, PARAM_KIND_LENGTH],
    arc: [
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
        PARAM_KIND_COORDINATE,
    ],
};

/**
 * Pads/truncates a snapshot to the entity type's param layout. Hand-edited or
 * legacy data can carry a truncated snapshot — normalizing beats throwing from a
 * property-listener path (updateExternalEntity's length guard), seeding garlic
 * with a short param array, or feeding NaN coordinates to shape building. Unknown
 * types and already-matching lengths pass through unchanged (same array identity).
 */
export function normalizeSnapshot(type: SketchEntityType, snapshot: number[]): number[] {
    const count = ENTITY_PARAM_KINDS[type]?.length;
    if (count === undefined || snapshot.length === count) return snapshot;
    return Array.from({ length: count }, (_, index) => snapshot[index] ?? 0);
}
