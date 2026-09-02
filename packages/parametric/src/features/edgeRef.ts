// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type IEdge, type IShape, Result, ShapeTypes, type XYZ } from "@chili3d/core";

export type Vec3 = { x: number; y: number; z: number };

/**
 * A geometric fingerprint of an edge, plus an optional stable `edgeId` from kernel
 * shape history (see `ParametricBodyNode.edgeIdAt`). Shape indices drift when the
 * upstream shape is rebuilt, so fillet/chamfer features store these instead and
 * re-match edges on the rebuilt input: `edgeId` hits exactly while the id survives,
 * the fingerprint is the fallback — see `matchEdgeIndexes`. Fingerprints match
 * exactly when the upstream is unchanged (OCCT rebuilds deterministically); edits
 * that move geometry (e.g. a parameter change) are matched to the closest
 * unambiguous edge instead.
 */
export type EdgeRef =
    | { kind: "line"; start: Vec3; end: Vec3; edgeId?: string }
    | { kind: "circle"; center: Vec3; radius: number; axis: Vec3; edgeId?: string }
    | { kind: "other"; mid: Vec3; length: number; edgeId?: string };

/** Coordinates below this distance (mm) count as the same edge. */
export const MATCH_TOLERANCE = 1e-4;

export function captureEdgeRef(edge: IEdge, edgeId?: string): EdgeRef {
    const basis = edge.curve.basisCurve;
    if (CurveUtils.isCircle(basis)) {
        return {
            kind: "circle",
            center: vec3(basis.center),
            radius: basis.radius,
            axis: vec3(basis.axis),
            edgeId,
        };
    }
    if (CurveUtils.isLine(basis)) {
        return { kind: "line", start: vec3(edge.startPoint()), end: vec3(edge.endPoint()), edgeId };
    }
    const midParam = (edge.firstParameter() + edge.lastParameter()) / 2;
    return { kind: "other", mid: vec3(edge.pointAt(midParam)), length: edge.length(), edgeId };
}

/**
 * Like `matchEdgeIndexes`, but refs carrying an `edgeId` that still exists in
 * `inputEdgeIds` (findSubShapes order of `shape`'s rebuild input) resolve exactly;
 * the rest fall back to fingerprint matching. An id hit consumes the index, so a
 * fingerprint cannot steal it (and vice versa — a collision is ambiguous).
 */
export function matchEdgeIndexesTracked(
    shape: IShape,
    refs: EdgeRef[],
    inputEdgeIds: readonly string[],
): Result<number[]> {
    const resolved = new Set<number>();
    const remaining: EdgeRef[] = [];
    for (const ref of refs) {
        const index = ref.edgeId === undefined ? -1 : inputEdgeIds.indexOf(ref.edgeId);
        if (index >= 0 && !resolved.has(index)) {
            resolved.add(index);
        } else {
            remaining.push(ref);
        }
    }
    if (remaining.length === 0) return Result.ok([...resolved]);
    const matched = matchEdgeIndexes(shape, remaining);
    if (!matched.isOk) return Result.err(matched.error);
    for (const index of matched.value) {
        if (resolved.has(index)) return Result.err("Edge match is ambiguous after rebuild");
        resolved.add(index);
    }
    return Result.ok([...resolved]);
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
        if (indexes.has(best.index)) return Result.err("Edge match is ambiguous after rebuild");
        indexes.add(best.index);
    }
    return Result.ok([...indexes]);
}

/**
 * A moved edge counts as matched only when the runner-up is at least 50% farther away.
 * A sole candidate wins by default — unless its score is infinite, which means its
 * curve type does not match the ref at all.
 */
function isClearWinner(bestScore: number, secondScore: number | undefined): boolean {
    if (!Number.isFinite(bestScore)) return false;
    return secondScore === undefined || secondScore > 1.5 * bestScore + MATCH_TOLERANCE;
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

/**
 * Best (lowest) score of `ref` against `edges` — Infinity when no edge's curve type
 * matches at all. Unlike `matchEdgeIndexes` this never accepts a "sole candidate":
 * callers comparing several candidate shapes need comparable scores, not a winner.
 */
export function bestEdgeScore(edges: IEdge[], ref: EdgeRef): number {
    let best = Infinity;
    for (const edge of edges) {
        best = Math.min(best, refScore(ref, edge));
    }
    return best;
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
