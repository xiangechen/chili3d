// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type IEdge, type IShape, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { idsOverlap } from "./feature";

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
 *
 * `splitPiece` records that the id was already shared by several edges at capture
 * time — a boolean had split the original edge and the pick is just one piece.
 * `matchEdgeIndexesTracked` uses it to never widen such a ref to the whole span.
 * Absent on older documents, where refs keep the whole-span adoption.
 */
export type EdgeRef =
    | { kind: "line"; start: Vec3; end: Vec3; edgeId?: string; splitPiece?: boolean }
    | { kind: "circle"; center: Vec3; radius: number; axis: Vec3; edgeId?: string; splitPiece?: boolean }
    | { kind: "other"; mid: Vec3; length: number; edgeId?: string; splitPiece?: boolean };

/** Coordinates below this distance (mm) count as the same edge. */
export const MATCH_TOLERANCE = 1e-4;

export function captureEdgeRef(edge: IEdge, edgeId?: string, splitPiece?: boolean): EdgeRef {
    const basis = edge.curve.basisCurve;
    let ref: EdgeRef;
    if (CurveUtils.isCircle(basis)) {
        ref = {
            kind: "circle",
            center: vec3(basis.center),
            radius: basis.radius,
            axis: vec3(basis.axis),
            edgeId,
        };
    } else if (CurveUtils.isLine(basis)) {
        ref = { kind: "line", start: vec3(edge.startPoint()), end: vec3(edge.endPoint()), edgeId };
    } else {
        const midParam = (edge.firstParameter() + edge.lastParameter()) / 2;
        ref = { kind: "other", mid: vec3(edge.pointAt(midParam)), length: edge.length(), edgeId };
    }
    // Set only when true: absent keeps the serialized shape of older refs.
    if (splitPiece === true) ref.splitPiece = true;
    return ref;
}

/** Dot-product tolerance for direction parallelism (|dot| ≥ 1 − 1e-6). */
const PARALLEL_TOLERANCE = 1e-6;

/**
 * Rigid-move invariant of an id-resolved edge: the curve kind matches the
 * fingerprint's and the properties a rigid move preserves still agree — a line's
 * direction, a circle's axis, another curve's length. Position is deliberately not
 * compared: a parameter edit moves geometry rigidly, and moving IS the edit (the same
 * contract as the external-ref resolver). A mismatch means the id realigned onto a
 * different edge (a positional id drifting, or a kernel behavior change), so the
 * caller demotes the ref to fingerprint matching instead of trusting the id blindly.
 *
 * Why each curve kind is checked on that property: a line's length and a circle's
 * radius are the very parameters feature edits drive (extrude depth, hole diameter),
 * so comparing them would demote the id on every legitimate edit; direction and axis
 * survive those edits. A free-form curve has no such axis concept, and its only other
 * fingerprint datum is the mid point — position, deliberately unchecked — so length
 * is the only available invariant. The asymmetry is deliberate, and so is its price:
 * editing a spline's shape changes its length, demotes the id, and the fingerprint
 * (mid + length, both changed) may then fail with "Edge not found after rebuild".
 * That loud failure beats blindly trusting an id that may have drifted onto a
 * different edge.
 */
export function edgeMatchesRefInvariant(edge: IEdge, ref: EdgeRef): boolean {
    const basis = edge.curve.basisCurve;
    if (ref.kind === "line") {
        if (!CurveUtils.isLine(basis)) return false;
        const refDirection = new XYZ(ref.end).sub(new XYZ(ref.start)).normalize();
        const edgeDirection = edge.endPoint().sub(edge.startPoint()).normalize();
        return directionsParallel(refDirection, edgeDirection);
    }
    if (ref.kind === "circle") {
        if (!CurveUtils.isCircle(basis)) return false;
        return directionsParallel(new XYZ(ref.axis).normalize(), basis.axis.normalize());
    }
    return Math.abs(edge.length() - ref.length) <= MATCH_TOLERANCE;
}

/**
 * Parallel check on the unit dot product (|dot| ≥ 1 − 1e-6). Deliberately not
 * `XYZ.isParallelTo`, whose tolerance is angular (1e-6 rad) and would change the
 * sensitivity of every probe built on this. An undefined direction (a degenerate
 * edge) counts as not parallel. Shared with the sketch external-ref resolver, whose
 * geometry probes rely on the same sensitivity.
 */
export function directionsParallel(a: XYZ | undefined, b: XYZ | undefined): boolean {
    if (a === undefined || b === undefined) return false;
    return Math.abs(a.dot(b)) >= 1 - PARALLEL_TOLERANCE;
}

/**
 * Like `matchEdgeIndexes`, but refs carrying an `edgeId` resolve through the stable id
 * first: every input edge whose id intersects the ref's (`idsOverlap`) AND keeps the
 * fingerprint's rigid-move invariants (`edgeMatchesRefInvariant`) is adopted. Several
 * hits are the pieces of an edge a boolean split (feature-scoped ids are unique per
 * rebuild, so a duplicated id only comes from one-to-many derivation) or the pieces of
 * a re-split merge (a fused collinear edge carries a compound of its ancestors' ids),
 * and adopting the whole span matches the intent of an edge feature; a single hit is
 * the ordinary case. An id that is gone — or whose edge no longer keeps the invariants
 * (a positional id realigned onto another edge; a merged free-form curve, whose length
 * changed) — demotes the ref to fingerprint matching.
 *
 * One refinement: when exactly one of several hits still matches the fingerprint
 * within MATCH_TOLERANCE, the ref was captured from just that piece of an already
 * split edge, so only that piece is adopted — adopting the whole span would
 * silently widen the feature beyond what was picked. Zero exact matches means the
 * ref covered the whole edge (its pieces only approximate the span) — or the
 * geometry moved and every piece fails the stale fingerprint; several exact
 * matches means coincident pieces. All of these keep the whole-span adoption for
 * refs captured from the whole edge. A ref flagged `splitPiece` was captured from
 * one piece of an already split edge and never widens: zero exact matches adopts
 * the clearly closest piece (`isClearWinner`, the same rule moved-geometry
 * fingerprint matching uses), and a tie fails as ambiguous.
 */
export function matchEdgeIndexesTracked(
    shape: IShape,
    refs: EdgeRef[],
    inputEdgeIds: readonly string[],
): Result<number[]> {
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const byId = resolveById(edges, refs, inputEdgeIds);
    if (!byId.isOk) return Result.err(byId.error);
    const { resolved, remaining } = byId.value;
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
 * Resolves every ref through its stable id (see `matchEdgeIndexesTracked`):
 * adopted indexes plus the refs that missed and demote to fingerprint matching.
 */
function resolveById(
    edges: IEdge[],
    refs: EdgeRef[],
    inputEdgeIds: readonly string[],
): Result<{ resolved: Set<number>; remaining: EdgeRef[] }> {
    const resolved = new Set<number>();
    const remaining: EdgeRef[] = [];
    for (const ref of refs) {
        const hits: number[] = [];
        if (ref.edgeId !== undefined) {
            for (const [index, id] of inputEdgeIds.entries()) {
                if (
                    index < edges.length &&
                    idsOverlap(id, ref.edgeId) &&
                    edgeMatchesRefInvariant(edges[index], ref)
                ) {
                    hits.push(index);
                }
            }
        }
        if (hits.length === 0) {
            remaining.push(ref);
            continue;
        }
        const adopted = singleExactHit(hits, edges, ref);
        if (!adopted.isOk) return Result.err(adopted.error);
        if (adopted.value.some((index) => resolved.has(index))) {
            return Result.err("Edge match is ambiguous after rebuild");
        }
        for (const index of adopted.value) {
            resolved.add(index);
        }
    }
    return Result.ok({ resolved, remaining });
}

/**
 * Narrows several id hits. Exactly one piece still matching the fingerprint means
 * the ref was captured from just that piece of an already split edge — adopt only
 * it. Otherwise a whole-edge ref keeps the whole-span adoption (see the doc
 * above). A ref flagged `splitPiece` never widens: zero exact matches adopts the
 * clearly closest piece; a tie or several exact pieces is genuinely ambiguous.
 */
function singleExactHit(hits: number[], edges: IEdge[], ref: EdgeRef): Result<number[]> {
    if (hits.length === 1) return Result.ok(hits);
    const exact = hits.filter((index) => refScore(ref, edges[index]) <= MATCH_TOLERANCE);
    if (exact.length === 1) return Result.ok(exact);
    if (ref.splitPiece !== true) return Result.ok(hits);
    if (exact.length === 0) {
        const scored = hits.map((index) => ({ index, score: refScore(ref, edges[index]) }));
        scored.sort((a, b) => a.score - b.score);
        if (isClearWinner(scored[0].score, scored[1]?.score)) return Result.ok([scored[0].index]);
    }
    return Result.err("Edge match is ambiguous after rebuild");
}

/**
 * Fills the -1 entries of a kernel edge-history map by exact geometric identity: an
 * unmapped output edge inherits the input index of a fingerprint-identical input edge
 * (score within MATCH_TOLERANCE, the next rival at least MATCH_TOLERANCE farther, one
 * claim per input). Parametric rebuilds leave most sub-shapes unchanged, which is
 * exactly the part sparse kernel histories (e.g. revolve edges) fail to report.
 * Inputs already claimed by the map are not stolen. Face maps are left to the kernel:
 * populating them needs surface fingerprints, not just curve data. Completion is
 * best-effort: an edge whose kernel queries fail (a degenerate edge) simply never
 * claims or gets claimed.
 */
export function completeEdgeHistory(
    inputs: readonly IEdge[],
    outputs: readonly IEdge[],
    map: readonly number[],
): number[] {
    const completed = [...map];
    const claimed = new Set(completed.filter((index) => index >= 0));
    // Fingerprints are captured once per edge: scoring a live IEdge per candidate
    // pair would pay several kernel queries each (endpoints, curve data), and the
    // same output edge is scored against every unclaimed input.
    const inputRefs = captureRefs(inputs);
    for (const [outputIndex, output] of outputs.entries()) {
        if (completed[outputIndex] === undefined || completed[outputIndex] >= 0) continue;
        let outputRef: EdgeRef;
        try {
            outputRef = captureEdgeRef(output);
        } catch {
            // Degenerate output edge — its entry stays unmapped.
            continue;
        }
        const best = bestUnclaimedInput(outputRef, inputRefs, claimed);
        if (best >= 0) {
            completed[outputIndex] = best;
            claimed.add(best);
        }
    }
    return completed;
}

/**
 * Best unclaimed input for `outputRef`: within MATCH_TOLERANCE and at least
 * MATCH_TOLERANCE ahead of the next rival, else -1.
 */
function bestUnclaimedInput(
    outputRef: EdgeRef,
    inputRefs: { index: number; ref: EdgeRef }[],
    claimed: Set<number>,
): number {
    let best = -1;
    let bestScore = Infinity;
    let secondScore = Infinity;
    for (const { index, ref } of inputRefs) {
        if (claimed.has(index)) continue;
        const score = refScoreRefs(ref, outputRef);
        if (score < bestScore) {
            secondScore = bestScore;
            bestScore = score;
            best = index;
        } else if (score < secondScore) {
            secondScore = score;
        }
    }
    return best >= 0 && bestScore <= MATCH_TOLERANCE && secondScore - bestScore >= MATCH_TOLERANCE
        ? best
        : -1;
}

/** Captures every capturable edge's fingerprint once, keeping its original index. */
function captureRefs(edges: readonly IEdge[]): { index: number; ref: EdgeRef }[] {
    const refs: { index: number; ref: EdgeRef }[] = [];
    for (const [index, edge] of edges.entries()) {
        try {
            refs.push({ index, ref: captureEdgeRef(edge) });
        } catch {
            // Degenerate edge — it never claims an output.
        }
    }
    return refs;
}

/** `refScore` for two captured fingerprints — pure geometry, no kernel queries. */
function refScoreRefs(a: EdgeRef, b: EdgeRef): number {
    if (a.kind === "circle") {
        if (b.kind !== "circle") return Infinity;
        return distance(a.center, b.center) + Math.abs(a.radius - b.radius) + axisDistance(a.axis, b.axis);
    }
    if (a.kind === "line") {
        if (b.kind !== "line") return Infinity;
        const direct = distance(a.start, b.start) + distance(a.end, b.end);
        const flipped = distance(a.start, b.end) + distance(a.end, b.start);
        return Math.min(direct, flipped);
    }
    if (b.kind !== "other") return Infinity;
    return distance(a.mid, b.mid) + Math.abs(a.length - b.length);
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
    // Captured once up front: scoring a live edge per (ref, edge) pair would pay
    // several kernel queries each. An uncapturable (degenerate) edge throws at the
    // same point refScore would have thrown before.
    const captured = edges.map((edge) => captureEdgeRef(edge));

    const indexes = new Set<number>();
    for (const ref of refs) {
        const [best, second] = bestTwo(captured, ref);
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

function bestTwo(captured: EdgeRef[], ref: EdgeRef) {
    let best: { index: number; score: number } | undefined;
    let second: { index: number; score: number } | undefined;
    for (let index = 0; index < captured.length; index++) {
        const score = refScoreRefs(ref, captured[index]);
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

/** Scores a live edge by capturing its fingerprint first — the single scoring formula lives in `refScoreRefs`. */
function refScore(ref: EdgeRef, edge: IEdge): number {
    return refScoreRefs(ref, captureEdgeRef(edge));
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
