// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** A closed loop approximated as a 2D polygon, in whatever plane the caller works in. */
export type Polygon = readonly (readonly [number, number])[];

/**
 * Whether a point is inside a closed polygon, by counting the crossings of a ray
 * cast in +x from it.
 *
 * Vertices exactly at the ray's height are the degenerate case: an edge counts
 * only when its higher end is strictly above the ray, so a vertex shared by two
 * edges is skipped once rather than twice or not at all. Without that, a loop
 * whose vertex sits at the same height as the point reads inside-out.
 */
export function pointInPolygon(point: readonly [number, number], polygon: Polygon): boolean {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * The area a polygon encloses, signed by the direction it is wound in. A font
 * states a counter and the loop around it with opposite signs, so the sign is one
 * way to tell the two apart — the other being that the counter is covered twice.
 */
export function signedArea(polygon: Polygon): number {
    let twice = 0;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        twice += a[0] * b[1] - b[0] * a[1];
    }
    return twice / 2;
}

/** How a set of loops nests: which bound filled regions, and which are holes in one. */
export interface LoopNesting {
    /** How many loops enclose each loop. */
    depth: number[];
    /** The loops bounding a filled region: those enclosed an even number of times. */
    filled: number[];
    /** The loops that are holes in a filled region: those enclosed an odd number of times. */
    holes: number[];
    /** For each loop, the loops it encloses directly — a region's holes, when it is filled. */
    children: number[][];
}

/**
 * Sort loops by what encloses what.
 *
 * A loop enclosing an even number of others bounds a filled region; an odd number
 * makes it a hole in the region around it. That is the whole of how a counter is
 * stated — a hole is an ordinary loop that happens to sit inside another — so a
 * sketch's loops and a glyph's counters are read by this same rule, and neither
 * side states the parity again.
 *
 * Whether one loop encloses another is the caller's to decide, because it is not a
 * question about polygons alone: loops that may touch are tested differently from
 * loops that may only nest or stand apart.
 */
export function nestLoops(count: number, encloses: (outer: number, inner: number) => boolean): LoopNesting {
    const enclosedBy = Array.from({ length: count }, (_, inner) =>
        Array.from({ length: count }, (_, outer) => outer !== inner && encloses(outer, inner)),
    );
    const depth = enclosedBy.map((row) => row.filter(Boolean).length);

    return {
        depth,
        filled: depth.flatMap((level, loop) => (level % 2 === 0 ? [loop] : [])),
        holes: depth.flatMap((level, loop) => (level % 2 === 1 ? [loop] : [])),
        children: Array.from({ length: count }, (_, outer) =>
            enclosedBy.flatMap((row, inner) =>
                row[outer] && depth[inner] === depth[outer] + 1 ? [inner] : [],
            ),
        ),
    };
}
