// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Contours of a glyph, flattened into polygons and sorted into the filled regions
 * they bound. Nesting — which loop sits inside which — is the shared half, in
 * `core`.
 *
 * What stays here is what a glyph needs and a sketch does not: glyph loops are
 * stated by the even-odd rule and are as likely to *overlap* as to nest, so which
 * of them bound ink has to be counted per point rather than per loop.
 */

import { nestLoops, type Polygon, signedArea } from "../math";
import type { Contour2D, Segment2D, Vec2 } from "./fontOutline";

/**
 * A filled region of a glyph: its outline, and the loops that cut holes in it.
 * A glyph with a disconnected piece (the dot of an `i`) has one group per piece.
 */
export interface ContourGroup {
    outer: number;
    holes: number[];
}

/**
 * Steps used to flatten a curve when deciding what is inside what. Nesting only
 * has to tell whole loops apart, and a font's nested loops sit tens of font
 * units apart, so this needs no more resolution than that.
 */
const FLATTEN_STEPS = 16;

/** Points along a contour, with curves flattened into short straight runs. */
export function flattenContour(contour: Contour2D, steps = FLATTEN_STEPS): Vec2[] {
    const points: Vec2[] = [contour.start];
    let from = contour.start;

    for (const segment of contour.segments) {
        if (segment.kind !== "line") {
            for (let step = 1; step < steps; step++) {
                points.push(pointAlong(from, segment, step / steps));
            }
        }
        points.push(segment.to);
        from = segment.to;
    }

    return points;
}

/** A point partway along a segment, the curves evaluated rather than their chords taken. */
function pointAlong(start: Vec2, segment: Segment2D, t: number): Vec2 {
    const u = 1 - t;
    switch (segment.kind) {
        case "line":
            return {
                x: start.x + (segment.to.x - start.x) * t,
                y: start.y + (segment.to.y - start.y) * t,
            };
        case "quad":
            return {
                x: u * u * start.x + 2 * u * t * segment.c1.x + t * t * segment.to.x,
                y: u * u * start.y + 2 * u * t * segment.c1.y + t * t * segment.to.y,
            };
        case "cubic":
            return {
                x:
                    u * u * u * start.x +
                    3 * u * u * t * segment.c1.x +
                    3 * u * t * t * segment.c2.x +
                    t * t * t * segment.to.x,
                y:
                    u * u * u * start.y +
                    3 * u * u * t * segment.c1.y +
                    3 * u * t * t * segment.c2.y +
                    t * t * t * segment.to.y,
            };
    }
}

/**
 * A point just inside a loop's own boundary, along the inward normal of its
 * longest edge.
 *
 * This is the point to ask what covers a loop: a point further in could sit in a
 * part of the loop that something else covers too — the middle of an `O`'s outer
 * loop is inside its counter — and the answer wanted is about the loop's own edge.
 */
function justInside(polygon: Polygon, clockwise: boolean, step: number): readonly [number, number] {
    let longest = 0;
    let at: readonly [number, number] = polygon[0];

    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length <= longest) continue;
        longest = length;
        // A counter-clockwise loop keeps its inside on the left of each edge.
        const inward: readonly [number, number] = clockwise
            ? [b[1] - a[1], a[0] - b[0]]
            : [a[1] - b[1], b[0] - a[0]];
        const scale = step / length;
        at = [(a[0] + b[0]) / 2 + inward[0] * scale, (a[1] + b[1]) / 2 + inward[1] * scale];
    }

    return at;
}

/** Whether a point falls inside a loop, by counting the crossings of a ray cast in +x. */
function crossing(point: readonly [number, number], polygon: Polygon): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j];
        const b = polygon[i];
        if (a[1] > point[1] !== b[1] > point[1]) {
            const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
            if (point[0] < x) inside = !inside;
        }
    }
    return inside;
}

type Segment = readonly [readonly [number, number], readonly [number, number]];

function segmentsOf(polygon: Polygon): Segment[] {
    return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]] as const);
}

/** Whether two segments cross, as opposed to merely touching or running parallel. */
function cross(a: Segment, b: Segment): boolean {
    const side = (p: readonly [number, number], q: Segment) =>
        (q[0][0] - p[0]) * (q[1][1] - p[1]) - (q[0][1] - p[1]) * (q[1][0] - p[0]);
    const [d1, d2] = [side(a[0], b), side(a[1], b)];
    const [d3, d4] = [side(b[0], a), side(b[1], a)];

    return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether either loop has an edge that crosses the other's. */
function edgesCross(one: readonly Segment[], other: readonly Segment[]): boolean {
    return one.some((edge) => other.some((opposite) => cross(edge, opposite)));
}

/**
 * Sort a glyph's loops into the filled regions they bound, with the loops that cut
 * holes in each, and those regions into the solids they have to be drawn as.
 *
 * A glyph is filled by the even-odd rule: a point is ink when an odd number of its
 * loops cover it. That makes "which loop encloses which" the only question, and the
 * answer is not simply containment: a loop *cutting through* another is not inside
 * it, however many of its points happen to fall there. `田`'s two cross strokes and
 * its three-sided box are four loops that meet, and each of the four is a filled
 * region of its own — reading the crossings as holes is what turned a `田` into a
 * doubled-up solid.
 *
 * Loops that merely *touch* do enclose: a counter meeting its outline at a corner is
 * still a counter, and only edges that properly cross say otherwise.
 *
 * The outer array is the solids: regions whose loops cross go in one entry, because
 * they *overlap* — between them the ink is counted twice, and the crossing is a seam
 * down the middle of it. Regions that only touch stay separate, which costs nothing:
 * they do not overlap, so nothing is double counted and no seam falls inside the ink.
 * A stroke ending on another's edge (the stem of a `丁`) is a T-junction, and that
 * touching is all it is.
 */
export function groupContours(contours: readonly Contour2D[]): ContourGroup[][] {
    const polygons = contours.map((contour) =>
        flattenContour(contour).map((point): [number, number] => [point.x, point.y]),
    );
    if (polygons.length === 0) return [];

    const segments = polygons.map(segmentsOf);
    const samples = polygons.map((polygon) => {
        const xs = polygon.map((point) => point[0]);
        const ys = polygon.map((point) => point[1]);
        const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        // An offset small beside the loop, so it stays on the side of the edge it
        // started from however thin the loop is.
        return justInside(polygon, signedArea(polygon) < 0, span * 1e-6);
    });

    // Each pair is asked once, because both questions turn on the same answer and
    // asking twice means chaining every curve twice over.
    const crossings = polygons.map((_, one) =>
        polygons.map((_, other) => one < other && edgesCross(segments[one], segments[other])),
    );
    const crosses = (one: number, other: number) => crossings[Math.min(one, other)][Math.max(one, other)];

    const nesting = nestLoops(
        polygons.length,
        (outer, inner) => !crosses(outer, inner) && crossing(samples[inner], polygons[outer]),
    );

    const regions = nesting.filled.map((outer): ContourGroup => ({ outer, holes: nesting.children[outer] }));
    return fusingSets(regions, crosses);
}

/**
 * The regions sorted into the solids they make, as one set per run of regions that
 * overlap each other, directly or through a third.
 */
function fusingSets(
    regions: readonly ContourGroup[],
    crosses: (one: number, other: number) => boolean,
): ContourGroup[][] {
    const setOf = regions.map((_, index) => index);
    const find = (index: number): number => {
        let root = index;
        while (setOf[root] !== root) root = setOf[root];
        return root;
    };

    for (let one = 0; one < regions.length; one++) {
        for (let other = one + 1; other < regions.length; other++) {
            if (overlapping(regions[one], regions[other], crosses)) setOf[find(one)] = find(other);
        }
    }

    const sets = new Map<number, ContourGroup[]>();
    regions.forEach((region, index) => {
        const found = find(index);
        sets.set(found, [...(sets.get(found) ?? []), region]);
    });
    return [...sets.values()];
}

/** Whether two regions overlap: a loop of one crossing a loop of the other. */
function overlapping(
    one: ContourGroup,
    other: ContourGroup,
    crosses: (one: number, other: number) => boolean,
): boolean {
    const mine = [one.outer, ...one.holes];
    const theirs = [other.outer, ...other.holes];
    return mine.some((loop) => theirs.some((opposite) => crosses(loop, opposite)));
}
