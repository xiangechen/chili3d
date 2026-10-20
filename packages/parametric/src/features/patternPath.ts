// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICurve, type IEdge, type Matrix4, Precision, Result, type XYZ } from "@chili3d/core";

/**
 * The path a curve pattern runs along: an unordered set of fingerprinted edges turned into one
 * end-to-end chain, then measured by arc length.
 *
 * Two steps, kept apart because they answer different questions:
 *
 * - `orderPathEdges` walks the picked edges by their shared endpoints. A multi-pick reports the
 *   click order, which has nothing to do with the chain (a user clicks a middle segment first as
 *   readily as an end one), so the walk starts at an end and follows the connection. A fork or a
 *   disconnected set is refused rather than guessed at: the copies would otherwise stack on a
 *   branch the user never meant.
 * - `measuredPath` samples every edge by arc length, because a curve's own parameter rarely moves
 *   in step with its length (the convention `core/src/text/pathFrames.ts` established for text).
 *   The frame at an abscissa is interpolated in PARAMETER space between two samples and evaluated
 *   on the curve, so a copy sits exactly on the path rather than on a chord.
 */

/** One edge of the chain, and whether walking the chain runs it against its own direction. */
export interface OrderedPathEdge {
    readonly edge: IEdge;
    readonly reversed: boolean;
}

/** A point on the path and the unit direction of travel there. */
export interface PatternPathFrame {
    readonly point: XYZ;
    readonly tangent: XYZ;
}

/** A measured path: its total length, whether it closes, and the frame at any abscissa. */
export interface PatternPathFrames {
    readonly length: number;
    readonly closed: boolean;
    /** The frame at a distance along the path; clamped on an open path and wrapped on a closed one. */
    at(abscissa: number): PatternPathFrame | undefined;
}

/** Fresh sample counts per edge: enough for a smooth curve, cheap enough for a live preview. */
const SAMPLES_MIN = 8;
const SAMPLES_MAX = 64;

/** An edge's arc-length samples: the points, their curve parameters, and the edge's length. */
interface EdgeSamples {
    readonly edge: IEdge;
    readonly reversed: boolean;
    readonly curve: ICurve;
    readonly length: number;
    readonly points: readonly XYZ[];
    readonly parameters: readonly number[];
    /** Distance from the start of the whole path to this edge's start. */
    readonly start: number;
}

/**
 * The picked edges as ONE chain, in walk order. The walk starts at an end (an endpoint no other
 * edge shares); a fully closed set has no end, so it starts from the first edge as given. Every
 * edge must be used or the set is refused — a disconnected pick is a mistake to report, not a
 * path to invent.
 */
export function orderPathEdges(edges: readonly IEdge[]): Result<OrderedPathEdge[]> {
    if (edges.length === 0) return Result.err("Pattern path has no edges");
    const ends = pathEnds(edges);
    if (ends.some((end) => endpointDegree(ends, end) > 1)) {
        return Result.err("Pattern path branches; its edges must form a single chain");
    }
    // A chain end shares its point with no other edge; a fully closed set has no end, so the
    // walk starts from the first edge as given.
    const start = ends.find((end) => endpointDegree(ends, end) === 0) ?? ends[0];
    const ordered = walkChain(edges, ends, start);
    return ordered === undefined
        ? Result.err("Pattern path edges must connect end to end")
        : Result.ok(ordered);
}

/** One edge endpoint, with the edge and the side it belongs to. */
interface PathEnd {
    readonly index: number;
    /** True for the edge's `endPoint()` side. */
    readonly atEnd: boolean;
    readonly point: XYZ;
}

function pathEnds(edges: readonly IEdge[]): PathEnd[] {
    return edges.flatMap((edge, index) => [
        { index, atEnd: false, point: edge.startPoint() },
        { index, atEnd: true, point: edge.endPoint() },
    ]);
}

/** How many OTHER edges meet this endpoint — 1 along a chain, 2 or more at a fork. */
function endpointDegree(ends: readonly PathEnd[], end: PathEnd): number {
    return ends.filter((other) => other.index !== end.index && samePoint(other.point, end.point)).length;
}

/**
 * Follows the connections from `start`, turning edges around when the walk meets their far end.
 * Undefined when it could not use every edge — the set is not one chain.
 */
function walkChain(
    edges: readonly IEdge[],
    ends: readonly PathEnd[],
    start: PathEnd,
): OrderedPathEdge[] | undefined {
    const ordered: OrderedPathEdge[] = [];
    const used = new Set<number>();
    let index = start.index;
    let atEnd = start.atEnd;
    let cursor = atEnd ? edges[index].startPoint() : edges[index].endPoint();

    while (true) {
        used.add(index);
        ordered.push({ edge: edges[index], reversed: atEnd });
        const next = ends.find(
            (end) => end.index !== index && !used.has(end.index) && samePoint(end.point, cursor),
        );
        if (next === undefined) break;
        index = next.index;
        atEnd = next.atEnd;
        cursor = atEnd ? edges[index].startPoint() : edges[index].endPoint();
    }
    return used.size === edges.length ? ordered : undefined;
}

function samePoint(a: XYZ, b: XYZ): boolean {
    return a.distanceTo(b) <= Precision.Distance;
}

/**
 * Measures an ordered chain: each edge sampled uniformly by arc length, the samples carrying the
 * curve parameter so a distance can be turned back into an exact point on the curve. `transform`
 * carries the whole path from the frame it was sampled in into the one the caller builds in
 * (a source node's local frame into the host body's, say) — points are mapped, tangents are
 * mapped and renormalised.
 */
export function measuredPath(
    edges: readonly OrderedPathEdge[],
    transform?: Matrix4,
): Result<PatternPathFrames> {
    if (edges.length === 0) return Result.err("Pattern path has no edges");
    const lengths = edges.map(({ edge }) => edge.length());
    if (lengths.some((length) => length <= Precision.Distance)) {
        return Result.err("Pattern path has an edge with no length");
    }
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total <= Precision.Distance) return Result.err("Pattern path has no length");

    const samples = sampleChain(edges, lengths, total);
    if (!samples.isOk) return Result.err(samples.error);
    const closed = chainCloses(samples.value);
    return Result.ok({
        length: total,
        closed,
        at: (abscissa) => frameAt(samples.value, total, closed, abscissa, transform),
    });
}

/** Every edge sampled in walk order, each carrying its offset into the whole path. */
function sampleChain(
    edges: readonly OrderedPathEdge[],
    lengths: readonly number[],
    total: number,
): Result<EdgeSamples[]> {
    const samples: EdgeSamples[] = [];
    let offset = 0;
    for (const [index, ordered] of edges.entries()) {
        const measured = sampleEdge(ordered, lengths[index], offset, total);
        if (!measured.isOk) return Result.err(measured.error);
        samples.push(measured.value);
        offset += lengths[index];
    }
    return Result.ok(samples);
}

/** Whether the walk's last edge ends where its first one began. */
function chainCloses(samples: readonly EdgeSamples[]): boolean {
    const first = orderedStart(samples[0]);
    const lastOrdered = samples[samples.length - 1];
    const last = lastOrdered.reversed ? lastOrdered.edge.startPoint() : lastOrdered.edge.endPoint();
    return first.distanceTo(last) <= Precision.Distance;
}

/** The point the chain starts at, taking a reversed first edge into account. */
function orderedStart(sample: EdgeSamples): XYZ {
    return sample.reversed ? sample.edge.endPoint() : sample.edge.startPoint();
}

/** Samples one edge of the chain and records its place in the whole path. */
function sampleEdge(
    ordered: OrderedPathEdge,
    length: number,
    start: number,
    total: number,
): Result<EdgeSamples> {
    const curve = ordered.edge.curve;
    const count = Math.min(SAMPLES_MAX, Math.max(SAMPLES_MIN, Math.ceil((length / total) * SAMPLES_MAX)));
    const points = curve.uniformAbscissaByCount(count);
    if (points.length < 2) return Result.err("Pattern path edge could not be sampled");
    const parameters = sampleParameters(curve, points);
    if (!parameters.isOk) return Result.err(parameters.error);
    return Result.ok({
        edge: ordered.edge,
        reversed: ordered.reversed,
        curve,
        length,
        points,
        parameters: parameters.value,
        start,
    });
}

/**
 * The curve parameter of each sampled point, ordered along the walk. A loop's seam is the same
 * point at both ends of the range; the samples are ordered along the curve, so a step back means
 * the seam was crossed — take the next turn instead.
 */
function sampleParameters(curve: ICurve, points: readonly XYZ[]): Result<number[]> {
    const period = curve.isPeriodic() ? curve.period() : 0;
    const parameters: number[] = [];
    let previous = Number.NEGATIVE_INFINITY;
    for (const point of points) {
        let parameter = curve.parameter(point, Precision.Distance);
        if (parameter === undefined) {
            return Result.err("Pattern path edge could not be measured along its length");
        }
        while (period > 0 && parameter < previous) parameter += period;
        parameters.push(parameter);
        previous = parameter;
    }
    return Result.ok(parameters);
}

/** The frame at a distance along the path, found in the edge the distance falls on. */
function frameAt(
    samples: readonly EdgeSamples[],
    total: number,
    closed: boolean,
    abscissa: number,
    transform: Matrix4 | undefined,
): PatternPathFrame | undefined {
    const distance = closed ? ((abscissa % total) + total) % total : Math.max(0, Math.min(total, abscissa));
    const sample = samples.find(
        (candidate, index) => index === samples.length - 1 || distance < candidate.start + candidate.length,
    );
    if (sample === undefined) return undefined;
    const frame = frameOfEdge(sample, distance - sample.start);
    if (frame === undefined || transform === undefined) return frame;
    return {
        point: transform.ofPoint(frame.point),
        tangent: transform.ofVector(frame.tangent).normalize() ?? frame.tangent,
    };
}

/** The frame at a distance from one edge's own start, honouring a reversed walk. */
function frameOfEdge(sample: EdgeSamples, local: number): PatternPathFrame | undefined {
    const forward = sample.reversed ? sample.length - local : local;
    const last = sample.points.length - 1;
    const position = Math.max(0, Math.min(1, forward / sample.length)) * last;
    const before = Math.min(Math.floor(position), last - 1);
    const after = before + 1;
    const ratio = position - before;
    const parameter =
        sample.parameters[before] + (sample.parameters[after] - sample.parameters[before]) * ratio;
    const point = sample.curve.value(parameter);
    // A curve has no direction where its derivative vanishes; the chord between the samples
    // around it still says which way the path runs.
    const tangent =
        sample.curve.d1(parameter).vec.normalize() ??
        sample.points[after].sub(sample.points[before]).normalize();
    if (tangent === undefined) return undefined;
    return { point, tangent: sample.reversed ? tangent.reverse() : tangent };
}
