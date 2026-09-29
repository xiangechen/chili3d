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
    /** How many loops enclose each loop. */ depth: number[];
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

type Point2 = [number, number];

/**
 * The triangles of a polygon with holes, as a flat corner list — three corners per
 * triangle, in the winding the outer ring came in.
 *
 * Holes are bridged into the outer ring one at a time, topmost point first, along a
 * zero-width channel to the ring — straight up to the edge directly above when that
 * reaches it cleanly, to the nearest reachable vertex when a previous channel stands
 * in the way. The bridged ring is then ear-clipped. The channel's doubled edges make
 * zero-area ears, which are cut but not emitted, so the result covers the region and
 * the holes stay empty. Glyph counters are the standing case: convex-ish loops well
 * inside their outline, which a vertical channel bridges without crossing anything.
 */
export function triangulatePolygon(outer: Polygon, holes: readonly Polygon[] = []): Point2[] {
    const ring = cleanRing(outer);
    if (ring.length < 3) return [];
    let polygon = signedArea(ring) < 0 ? [...ring].reverse() : ring;

    // the bridged loop ear-clips only when holes wind against the outer ring
    const sortedHoles = holes
        .map(cleanRing)
        .filter((hole) => hole.length >= 3)
        .map((points) => (signedArea(points) > 0 ? [...points].reverse() : points))
        .map((points) => ({ points, top: topmost(points) }))
        .sort((a, b) => b.points[b.top][1] - a.points[a.top][1]);
    for (let h = 0; h < sortedHoles.length; h++) {
        const { points, top } = sortedHoles[h];
        polygon = bridgeHole(
            polygon,
            points,
            top,
            sortedHoles.slice(h + 1).map((hole) => hole.points),
        );
    }

    return earClip(polygon);
}

/** The ring without repeated neighbours or a repeated closing point. */
function cleanRing(ring: Polygon): Point2[] {
    const points: Point2[] = [];
    for (const [x, y] of ring) {
        const last = points[points.length - 1];
        if (last !== undefined && last[0] === x && last[1] === y) continue;
        points.push([x, y]);
    }
    while (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
    return points;
}

const samePoint = (a: Point2, b: Point2) => a[0] === b[0] && a[1] === b[1];

/** Index of the highest point, the leftmost one breaking a tie. */
function topmost(points: readonly Point2[]): number {
    let top = 0;
    for (let i = 1; i < points.length; i++) {
        if (
            points[i][1] > points[top][1] ||
            (points[i][1] === points[top][1] && points[i][0] < points[top][0])
        ) {
            top = i;
        }
    }
    return top;
}

const cross2 = (a: Point2, b: Point2, c: Point2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Joins a hole to the outer ring with a zero-width channel from its topmost point:
 * straight up to the edge first crossed when that channel reaches the ring cleanly,
 * to the nearest reachable vertex otherwise. A hole nothing can reach is dropped
 * rather than bridged into nowhere. `pending` holds the holes still waiting for a
 * channel — a channel may not cross them either.
 *
 * The two ends of a channel sit twice on the bridged ring, once per side, and no
 * later channel may land on such a vertex again: two channels through one point
 * coincide there, and ear clipping reads coincident corners of different channels
 * as one vertex, cutting triangles across a hole.
 */
function bridgeHole(polygon: Point2[], hole: Point2[], top: number, pending: readonly Point2[][]): Point2[] {
    const m = hole[top];
    const visits = new Map<string, number>();
    for (const p of polygon) visits.set(`${p[0]},${p[1]}`, (visits.get(`${p[0]},${p[1]}`) ?? 0) + 1);
    const channelPoint = (p: Point2) => (visits.get(`${p[0]},${p[1]}`) ?? 0) > 1;

    let candidate = bridgeCandidateUp(polygon, m, channelPoint);
    if (candidate < 0) candidate = nearestReachable(polygon, hole, pending, m, channelPoint);
    if (candidate < 0) return polygon;

    const rotated = [...hole.slice(top), ...hole.slice(0, top)];
    return [
        ...polygon.slice(0, candidate + 1),
        ...rotated,
        m,
        polygon[candidate],
        ...polygon.slice(candidate + 1),
    ];
}

/**
 * The vertex a straight-up channel from `m` can end at, or -1 for none: the edge
 * first crossed decides the bridge end, unless a vertex stands inside the channel
 * triangle, in which case the most central such vertex does — the channel then
 * cannot cross an edge between the two ends. Vertices already ending a channel are
 * off-limits, as is any end the channel still meets the ring on the way to — a
 * previous channel can block the way without a vertex inside the channel triangle.
 */
function bridgeCandidateUp(polygon: Point2[], m: Point2, channelPoint: (p: Point2) => boolean): number {
    let bridgeY = Infinity;
    let candidate = -1;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (a[0] > m[0] === b[0] > m[0]) continue;
        const y = a[1] + ((b[1] - a[1]) * (m[0] - a[0])) / (b[0] - a[0]);
        if (y <= m[1] || y >= bridgeY) continue;
        const higher = a[1] >= b[1] ? i : (i + 1) % polygon.length;
        const lower = higher === i ? (i + 1) % polygon.length : i;
        const end = channelPoint(polygon[higher]) && polygon[lower][1] > m[1] ? lower : higher;
        if (channelPoint(polygon[end])) continue;
        bridgeY = y;
        candidate = end;
    }
    if (candidate < 0) return -1;

    // a vertex inside the channel triangle would leave the channel crossing its edges
    const apex: Point2 = [m[0], bridgeY];
    let bestDx = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i];
        if (p[1] <= m[1] || channelPoint(p) || !strictlyInside(p, m, apex, polygon[candidate])) continue;
        const dx = Math.abs(p[0] - m[0]);
        if (dx < bestDx || (dx === bestDx && p[1] < polygon[candidate][1])) {
            bestDx = dx;
            candidate = i;
        }
    }
    return channelCrosses(polygon, m, polygon[candidate], polygon[candidate]) ? -1 : candidate;
}

/**
 * The nearest ring vertex a channel from `m` reaches without meeting the ring, the
 * hole itself, or a hole still waiting for its channel — the fallback when no
 * straight-up channel is clean. Vertices already ending a channel stay off-limits.
 */
function nearestReachable(
    polygon: Point2[],
    hole: Point2[],
    pending: readonly Point2[][],
    m: Point2,
    channelPoint: (p: Point2) => boolean,
): number {
    let index = -1;
    let distance = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const v = polygon[i];
        if (channelPoint(v)) continue;
        const d = (v[0] - m[0]) ** 2 + (v[1] - m[1]) ** 2;
        if (d === 0 || d >= distance) continue;
        if (channelCrosses(polygon, m, v, v) || channelCrosses(hole, m, v, m)) continue;
        if (pending.some((waiting) => channelCrosses(waiting, m, v, undefined))) continue;
        distance = d;
        index = i;
    }
    return index;
}

/** Whether the channel `m`→`v` meets any of the ring's edges anywhere but at `touch`. */
function channelCrosses(ring: readonly Point2[], m: Point2, v: Point2, touch: Point2 | undefined): boolean {
    for (let i = 0; i < ring.length; i++) {
        if (segmentsMeet(m, v, ring[i], ring[(i + 1) % ring.length], touch)) return true;
    }
    return false;
}

/**
 * Whether the segments `m`→`v` and `a`→`b` meet anywhere but at `touch`, an endpoint
 * of `m`→`v`: crossing interiors count, as does grazing a point of the other segment
 * or overlapping it — only touching at `touch` alone is allowed.
 */
function segmentsMeet(m: Point2, v: Point2, a: Point2, b: Point2, touch: Point2 | undefined): boolean {
    const d1 = cross2(a, b, m);
    const d2 = cross2(a, b, v);
    const d3 = cross2(m, v, a);
    const d4 = cross2(m, v, b);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    const touches = (p: Point2) => touch !== undefined && samePoint(p, touch);
    if (d3 === 0 && d4 === 0) {
        // collinear: project on the channel; shared length blocks, a lone shared point away from `touch` too
        const dx = v[0] - m[0];
        const dy = v[1] - m[1];
        const len2 = dx * dx + dy * dy;
        const ta = (a[0] - m[0]) * dx + (a[1] - m[1]) * dy;
        const tb = (b[0] - m[0]) * dx + (b[1] - m[1]) * dy;
        const lo = Math.max(0, Math.min(ta, tb));
        const hi = Math.min(len2, Math.max(ta, tb));
        if (hi < lo) return false;
        const touchT = touch === undefined ? -1 : samePoint(touch, v) ? len2 : 0;
        return hi > lo || hi !== touchT;
    }
    if (d3 === 0 && !touches(a) && onSegment(a, m, v)) return true;
    if (d4 === 0 && !touches(b) && onSegment(b, m, v)) return true;
    return false;
}

/** Whether `p` — known to sit on the line through `a` and `b` — lies between them. */
const onSegment = (p: Point2, a: Point2, b: Point2) =>
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);

/** Whether `p` lies inside the triangle, boundary excluded. */
function strictlyInside(p: Point2, a: Point2, b: Point2, c: Point2): boolean {
    const d1 = cross2(a, b, p);
    const d2 = cross2(b, c, p);
    const d3 = cross2(c, a, p);
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNegative && hasPositive) && d1 !== 0 && d2 !== 0 && d3 !== 0;
}

/**
 * Ear-clips a ring that is already one simple loop. The ring walks a doubly-linked
 * list, cutting the first convex corner no remaining vertex falls on or inside and
 * re-testing only the cut's two neighbours — the classic O(n²) clipper, fast for
 * the few hundred points a flattened glyph reaches. (A vertex on an ear's edge
 * blocks it — a reflex vertex sitting exactly on the diagonal is what keeps a cut
 * from covering the notch.) Zero-area corners (a bridge channel's doubled points)
 * are cut too, but only corners with real area are emitted. Should a full round
 * find no ear — a self-touching ring — the most convex corner is cut anyway, so a
 * degenerate input degrades to extra slivers rather than a hang.
 */
function earClip(polygon: Point2[]): Point2[] {
    const count0 = polygon.length;
    if (count0 < 3) return [];
    let diagonal = 0;
    for (const [x, y] of polygon) {
        diagonal = Math.max(diagonal, x * x + y * y);
    }
    const eps = Math.max(diagonal, 1) * 1e-12;

    const prev = polygon.map((_, i) => (i - 1 + count0) % count0);
    const next = polygon.map((_, i) => (i + 1) % count0);
    const alive = polygon.map(() => true);
    let count = count0;
    let current = 0;
    let round = 0;
    const triangles: Point2[] = [];

    while (count > 3) {
        const a = polygon[prev[current]];
        const b = polygon[current];
        const c = polygon[next[current]];
        const cross = cross2(a, b, c);
        if (
            cross >= -eps &&
            (cross <= eps || !vertexBlocks(polygon, alive, prev[current], current, next[current]))
        ) {
            if (cross > eps) triangles.push(a, b, c);
            const p = prev[current];
            const nx = next[current];
            next[p] = nx;
            prev[nx] = p;
            alive[current] = false;
            count--;
            round = 0;
            current = p;
            continue;
        }
        round++;
        if (round > count) {
            // no ear in a full round: cut the most convex corner, ignoring containment
            let argmax = next[current];
            let at = argmax;
            for (let i = 0; i < count; i++) {
                const crossAt = cross2(polygon[prev[at]], polygon[at], polygon[next[at]]);
                const crossMax = cross2(polygon[prev[argmax]], polygon[argmax], polygon[next[argmax]]);
                if (crossAt > crossMax) argmax = at;
                at = next[at];
            }
            const p = prev[argmax];
            const nx = next[argmax];
            if (cross2(polygon[p], polygon[argmax], polygon[nx]) > eps) {
                triangles.push(polygon[p], polygon[argmax], polygon[nx]);
            }
            next[p] = nx;
            prev[nx] = p;
            alive[argmax] = false;
            count--;
            round = 0;
            current = p;
            continue;
        }
        current = next[current];
    }
    const a = polygon[current];
    const b = polygon[next[current]];
    const c = polygon[next[next[current]]];
    if (cross2(a, b, c) > eps) triangles.push(a, b, c);
    return triangles;
}

/** Whether any live vertex falls on or inside the ear — its own corners excepted. */
function vertexBlocks(
    polygon: readonly Point2[],
    alive: readonly boolean[],
    ia: number,
    ib: number,
    ic: number,
): boolean {
    const a = polygon[ia];
    const b = polygon[ib];
    const c = polygon[ic];
    const minX = Math.min(a[0], b[0], c[0]);
    const maxX = Math.max(a[0], b[0], c[0]);
    const minY = Math.min(a[1], b[1], c[1]);
    const maxY = Math.max(a[1], b[1], c[1]);
    for (let i = 0; i < polygon.length; i++) {
        if (!alive[i] || i === ia || i === ib || i === ic) continue;
        const p = polygon[i];
        if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) continue;
        if (samePoint(p, a) || samePoint(p, b) || samePoint(p, c)) continue;
        const d1 = cross2(a, b, p);
        const d2 = cross2(b, c, p);
        const d3 = cross2(c, a, p);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) return true;
    }
    return false;
}
