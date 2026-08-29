// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type IEdge, type IShape, Result, ShapeTypes, type XYZ } from "@chili3d/core";

export type Vec3 = { x: number; y: number; z: number };

/**
 * A geometric fingerprint of an edge. Shape indices drift when the upstream shape
 * is rebuilt, so fillet/chamfer features store these instead and re-match edges on
 * the rebuilt input. Exact matches are expected when the upstream is unchanged
 * (OCCT rebuilds deterministically); edits that move geometry (e.g. a parameter
 * change) are matched to the closest unambiguous edge instead — see
 * `matchEdgeIndexes`.
 */
export type EdgeRef =
    | { kind: "line"; start: Vec3; end: Vec3 }
    | { kind: "circle"; center: Vec3; radius: number; axis: Vec3 }
    | { kind: "other"; mid: Vec3; length: number };

/** Coordinates below this distance (mm) count as the same edge. */
const MATCH_TOLERANCE = 1e-4;

export function captureEdgeRef(edge: IEdge): EdgeRef {
    const basis = edge.curve.basisCurve;
    if (CurveUtils.isCircle(basis)) {
        return { kind: "circle", center: vec3(basis.center), radius: basis.radius, axis: vec3(basis.axis) };
    }
    if (CurveUtils.isLine(basis)) {
        return { kind: "line", start: vec3(edge.startPoint()), end: vec3(edge.endPoint()) };
    }
    const midParam = (edge.firstParameter() + edge.lastParameter()) / 2;
    return { kind: "other", mid: vec3(edge.pointAt(midParam)), length: edge.length() };
}

/**
 * Re-match stored refs against the edges of a rebuilt shape, returning the indexes
 * `shapeFactory.fillet`/`chamfer` expect. The indexes are positions in the array
 * `findSubShapes(ShapeTypes.edge)` returns — the same order the C++ side builds
 * with `TopExp::MapShapes`, so position i corresponds to `edgeMap.FindKey(i + 1)`.
 * An upstream parameter edit (e.g. extrude length) moves geometry rigidly, so a ref
 * beyond the exact tolerance is still accepted when one candidate is clearly closer
 * than every other. Fails when no clear match exists.
 */
export function matchEdgeIndexes(shape: IShape, refs: EdgeRef[]): Result<number[]> {
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    if (edges.length === 0) return Result.err("Shape has no edges");

    const indexes = new Set<number>();
    for (const ref of refs) {
        const [best, second] = bestTwo(edges, ref);
        if (best === undefined) return Result.err("Edge not found after rebuild");
        if (best.score <= MATCH_TOLERANCE) {
            if (second !== undefined && second.score - best.score < MATCH_TOLERANCE) {
                return Result.err("Edge match is ambiguous after rebuild");
            }
        } else if (!isClearWinner(best.score, second?.score)) {
            return Result.err("Edge not found after rebuild");
        }
        indexes.add(best.index);
    }
    return Result.ok([...indexes]);
}

/** A moved edge counts as matched only when the runner-up is at least 50% farther away. */
function isClearWinner(bestScore: number, secondScore: number | undefined): boolean {
    return secondScore !== undefined && secondScore > 1.5 * bestScore + MATCH_TOLERANCE;
}

function bestTwo(edges: IEdge[], ref: EdgeRef) {
    let best: { index: number; score: number } | undefined;
    let second: { index: number; score: number } | undefined;
    for (let index = 0; index < edges.length; index++) {
        const score = refScore(ref, edges[index]);
        if (best === undefined || score < best.score) {
            second = best;
            best = { index, score };
        } else if (second === undefined || score < second.score) {
            second = { index, score };
        }
    }
    return [best, second] as const;
}

function refScore(ref: EdgeRef, edge: IEdge): number {
    const basis = edge.curve.basisCurve;
    if (ref.kind === "circle") {
        if (!CurveUtils.isCircle(basis)) return Infinity;
        return (
            distance(vec3(basis.center), ref.center) +
            Math.abs(basis.radius - ref.radius) +
            axisDistance(vec3(basis.axis), ref.axis)
        );
    }
    if (ref.kind === "line") {
        if (!CurveUtils.isLine(basis)) return Infinity;
        const direct =
            distance(vec3(edge.startPoint()), ref.start) + distance(vec3(edge.endPoint()), ref.end);
        const flipped =
            distance(vec3(edge.startPoint()), ref.end) + distance(vec3(edge.endPoint()), ref.start);
        return Math.min(direct, flipped);
    }
    const midParam = (edge.firstParameter() + edge.lastParameter()) / 2;
    return distance(vec3(edge.pointAt(midParam)), ref.mid) + Math.abs(edge.length() - ref.length);
}

function vec3(xyz: XYZ): Vec3 {
    return { x: xyz.x, y: xyz.y, z: xyz.z };
}

function distance(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Rebuilt axes may flip sign; compare both orientations. */
function axisDistance(a: Vec3, b: Vec3): number {
    return Math.min(distance(a, b), distance(a, { x: -b.x, y: -b.y, z: -b.z }));
}
