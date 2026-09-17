// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type IEdge, type IShape, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { ID_COMPONENT_SEPARATOR, idsOverlap } from "./trackedId";

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
 * `matchEdgesAnchored` uses it to never widen such a ref to the whole span.
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
 * Fingerprint equality, field by field — JSON.stringify equality is key-order
 * sensitive. The kernel `edgeId` is NOT compared (it identifies the edge, not the
 * geometry); callers needing it compare it themselves.
 */
export function sameEdgeFingerprint(a: EdgeRef, b: EdgeRef): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "line" && b.kind === "line") {
        return sameVec(a.start, b.start) && sameVec(a.end, b.end);
    }
    if (a.kind === "circle" && b.kind === "circle") {
        return sameVec(a.center, b.center) && a.radius === b.radius && sameVec(a.axis, b.axis);
    }
    if (a.kind === "other" && b.kind === "other") {
        return sameVec(a.mid, b.mid) && a.length === b.length;
    }
    return false;
}

function sameVec(a: Vec3, b: Vec3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

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
 * The matched edge indexes of `matchEdgesAnchored`, plus per-ref anchors refreshed
 * to what each ref actually matched this run. A ref whose stored id is GONE from
 * the rebuilt shape (or never had one) and recovered geometrically is re-captured
 * from the matched edge (fresh fingerprint, the edge's current id, `splitPiece`
 * when that id is shared by several edges) — the body writes it back untransacted,
 * so a later rebuild resolves by id again instead of re-paying (and risking)
 * fingerprint matching with a dead id. This is the `resolvedProfiles` re-anchoring
 * contract applied to edge refs. Two kinds of refs pass through unchanged:
 * id-hit refs (a live id is already the freshest anchor, and rewriting it to an
 * overlapping compound id — the edge merged with another — would silently widen
 * the ref beyond its picked span when the merge re-splits) and refs whose id is
 * still ALIVE but failed the invariant check this run (e.g. a merged free-form
 * curve whose length changed): rewriting those would sever the ref from its
 * original edge — which can claim it back once the invariant holds again — and
 * could stamp a `splitPiece` the user never picked.
 */
export interface AnchoredEdgeMatch {
    /** Matched edge indexes (a set) for `shapeFactory.fillet`/`chamfer`. */
    readonly indexes: number[];
    /** Per-ref anchors, parallel to the input refs. */
    readonly anchors: EdgeRef[];
}

/**
 * A captured edge fingerprint paired with the edge's original index. Degenerate
 * edges (zero length, no curve) throw on capture and are skipped, so positions in
 * this list do NOT parallel `edges` — scoring reports the stored index.
 */
interface CapturedEdgeRef {
    readonly index: number;
    readonly ref: EdgeRef;
}

/** Captures every edge's fingerprint once; a degenerate edge never matches. */
function captureEdgeRefs(edges: readonly IEdge[]): CapturedEdgeRef[] {
    const captured: CapturedEdgeRef[] = [];
    for (const [index, edge] of edges.entries()) {
        try {
            captured.push({ index, ref: captureEdgeRef(edge) });
        } catch {
            // Degenerate edge — excluded from matching.
        }
    }
    return captured;
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
export function matchEdgesAnchored(
    shape: IShape,
    refs: EdgeRef[],
    inputEdgeIds: readonly string[],
): Result<AnchoredEdgeMatch> {
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const byId = resolveById(edges, refs, inputEdgeIds);
    if (!byId.isOk) return Result.err(byId.error);
    const { resolved, remaining } = byId.value;
    const anchors: (EdgeRef | undefined)[] = refs.map((ref, index) =>
        remaining.includes(index) ? undefined : ref,
    );
    if (remaining.length > 0) {
        if (edges.length === 0) return Result.err("Shape has no edges");
        // Captured once: every remaining ref is scored against every capturable
        // edge; each entry keeps its edge's original index.
        const captured = captureEdgeRefs(edges);
        const perRef = matchCapturedRefs(
            captured,
            remaining.map((index) => refs[index]),
        );
        if (!perRef.isOk) return Result.err(perRef.error);
        for (const [k, refIndex] of remaining.entries()) {
            const edgeIndex = perRef.value[k];
            if (resolved.has(edgeIndex)) return Result.err("Edge match is ambiguous after rebuild");
            resolved.add(edgeIndex);
            anchors[refIndex] = reanchorRecoveredRef(
                refs[refIndex],
                edges[edgeIndex],
                inputEdgeIds,
                edgeIndex,
            );
        }
    }
    return Result.ok({ indexes: [...resolved], anchors: anchors as EdgeRef[] });
}

/**
 * Fresh anchor for a fingerprint-recovered ref — but only when the stored id is
 * GONE from the rebuilt shape (or the ref never had one): a live id whose invariant
 * check failed this run (e.g. a merged free-form curve's length changed) keeps the
 * user's ref untouched, so the original edge can claim it back once the invariant
 * holds again (see `AnchoredEdgeMatch`). `inputEdgeIds` parallels `edges`; an
 * out-of-range entry (an untracked upstream) yields an id-less anchor rather than
 * a fabricated one.
 */
function reanchorRecoveredRef(
    ref: EdgeRef,
    edge: IEdge,
    inputEdgeIds: readonly string[],
    edgeIndex: number,
): EdgeRef {
    const storedId = ref.edgeId;
    if (storedId !== undefined && inputEdgeIds.some((id) => idsOverlap(id, storedId))) return ref;
    const recoveredId = edgeIndex < inputEdgeIds.length ? inputEdgeIds[edgeIndex] : undefined;
    try {
        return captureEdgeRef(
            edge,
            recoveredId,
            recoveredId !== undefined && idIsShared(inputEdgeIds, recoveredId),
        );
    } catch {
        // Degenerate matched edge — keep the user's ref rather than fabricate an anchor.
        return ref;
    }
}

/**
 * True when the id overlaps more than one entry — pieces of a split sub-shape.
 * Overlap is component-wise (`idsOverlap`), not textual: a piece that merged with a
 * collinear neighbor carries a compound like `A|B` while its untouched sibling keeps
 * `A`, and both pieces are the same logical split edge. Exact duplicates — the only
 * case a textual comparison sees — are a subset of this.
 */
export function idIsShared(ids: readonly string[], id: string | undefined): boolean {
    return id !== undefined && indexesOfOverlappingId(ids, id).length > 1;
}

/**
 * Indexes of every id overlapping `id` (`idsOverlap`) — the shared scan behind
 * `IBodyTrackingNode.faceIndexesOfId`/`edgeIndexesOfId`, the sketch external-ref
 * stand-in lookup and the press-pull face matching. An undefined entry (tracking
 * lapsed for that sub-shape) never matches.
 */
export function indexesOfOverlappingId(ids: readonly (string | undefined)[], id: string): number[] {
    const indexes: number[] = [];
    for (let i = 0; i < ids.length; i++) {
        const value = ids[i];
        if (value !== undefined && idsOverlap(value, id)) indexes.push(i);
    }
    return indexes;
}

/**
 * Resolves every ref through its stable id (see `matchEdgesAnchored`): adopted
 * indexes plus the INDEXES of refs that missed and demote to fingerprint matching.
 */
function resolveById(
    edges: IEdge[],
    refs: EdgeRef[],
    inputEdgeIds: readonly string[],
): Result<{ resolved: Set<number>; remaining: number[] }> {
    const resolved = new Set<number>();
    const remaining: number[] = [];
    // Component → input indexes, built lazily on the first id-carrying ref: a bare
    // `idsOverlap` scan would re-split every input id (plus a Set each) once per
    // ref, while this index splits each id once and answers overlap by component
    // lookup. Bounded to `edges.length` exactly like the scan it replaces — the
    // unbounded overlap checks (`indexesOfOverlappingId`, `reanchorRecoveredRef`,
    // exported and called independently) deliberately keep their own scans rather
    // than paying for a second, unbounded index that runs at most once per
    // recovered ref.
    let byComponent: Map<string, number[]> | undefined;
    for (const [refIndex, ref] of refs.entries()) {
        const hits: number[] = [];
        if (ref.edgeId !== undefined) {
            byComponent ??= indexByIdComponent(inputEdgeIds, edges.length);
            for (const index of overlappingIndexes(byComponent, ref.edgeId)) {
                if (keepsInvariant(edges[index], ref)) {
                    hits.push(index);
                }
            }
        }
        if (hits.length === 0) {
            remaining.push(refIndex);
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
 * Component → indexes of every input id (below `bound`) containing it — the
 * `idsOverlap` scan precomputed.
 */
function indexByIdComponent(ids: readonly string[], bound: number): Map<string, number[]> {
    const byComponent = new Map<string, number[]>();
    for (let index = 0; index < ids.length && index < bound; index++) {
        for (const component of ids[index].split(ID_COMPONENT_SEPARATOR)) {
            const list = byComponent.get(component);
            if (list === undefined) byComponent.set(component, [index]);
            else list.push(index);
        }
    }
    return byComponent;
}

/**
 * Indexes overlapping `id` (component-wise set intersection, like `idsOverlap`),
 * in the ascending order the replaced scan produced — a compound id's components
 * each contribute their own ascending list, so the union is re-sorted.
 */
function overlappingIndexes(byComponent: Map<string, number[]>, id: string): number[] {
    const union = new Set<number>();
    for (const component of id.split(ID_COMPONENT_SEPARATOR)) {
        for (const index of byComponent.get(component) ?? []) union.add(index);
    }
    return [...union].sort((a, b) => a - b);
}

/**
 * `edgeMatchesRefInvariant` that treats a degenerate edge as failing the invariant:
 * its kernel queries throw, and a throwing edge is never a hit.
 */
function keepsInvariant(edge: IEdge, ref: EdgeRef): boolean {
    try {
        return edgeMatchesRefInvariant(edge, ref);
    } catch {
        return false;
    }
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
 * Fills the -1 entries of a kernel history map by exact geometric identity: an
 * unmapped output inherits the input index of a fingerprint-identical input (score
 * within MATCH_TOLERANCE, the next rival at least MATCH_TOLERANCE farther, one
 * claim per input). Parametric rebuilds leave most sub-shapes unchanged, which is
 * exactly the part sparse kernel histories fail to report. Inputs already claimed
 * by the map are not stolen. Completion is best-effort: a sub-shape whose kernel
 * queries fail (a degenerate edge or face) simply never claims or gets claimed.
 * Fingerprints are captured once per candidate — unclaimed inputs and unmapped
 * outputs only, and a fully mapped history returns without any capture: scoring a
 * live sub-shape per candidate pair would pay several kernel queries each, and the
 * same output is scored against every unclaimed input.
 */
export function completeHistory<TShape, TRef>(
    inputs: readonly TShape[],
    outputs: readonly TShape[],
    map: readonly number[],
    capture: (shape: TShape) => TRef,
    score: (a: TRef, b: TRef) => number,
): number[] {
    const completed = [...map];
    // Nothing to complete: skip every fingerprint capture.
    if (!completed.some((index) => index < 0)) return completed;
    const claimed = new Set(completed.filter((index) => index >= 0));
    const inputRefs: { index: number; ref: TRef }[] = [];
    for (const [index, input] of inputs.entries()) {
        // Claimed inputs are skipped at scoring time — don't pay for their capture.
        if (claimed.has(index)) continue;
        try {
            inputRefs.push({ index, ref: capture(input) });
        } catch {
            // Degenerate input — it never claims an output.
        }
    }
    for (const [outputIndex, output] of outputs.entries()) {
        if (completed[outputIndex] === undefined || completed[outputIndex] >= 0) continue;
        let outputRef: TRef;
        try {
            outputRef = capture(output);
        } catch {
            // Degenerate output — its entry stays unmapped.
            continue;
        }
        let best = -1;
        let bestScore = Infinity;
        let secondScore = Infinity;
        for (const { index, ref } of inputRefs) {
            if (claimed.has(index)) continue;
            const candidateScore = score(ref, outputRef);
            if (candidateScore < bestScore) {
                secondScore = bestScore;
                bestScore = candidateScore;
                best = index;
            } else if (candidateScore < secondScore) {
                secondScore = candidateScore;
            }
        }
        if (best >= 0 && bestScore <= MATCH_TOLERANCE && secondScore - bestScore >= MATCH_TOLERANCE) {
            completed[outputIndex] = best;
            claimed.add(best);
        }
    }
    return completed;
}

/**
 * Edge specialization of `completeHistory` (see it for the claiming rules): the
 * fingerprint is the `EdgeRef`, the score the fingerprint distance. Recovers the
 * unchanged edges sparse kernel histories (e.g. revolve edges) fail to report.
 */
export function completeEdgeHistory(
    inputs: readonly IEdge[],
    outputs: readonly IEdge[],
    map: readonly number[],
): number[] {
    return completeHistory(inputs, outputs, map, captureEdgeRef, refScoreRefs);
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
    return matchEdgesInEdges(edges, refs);
}

/**
 * `matchEdgeIndexes` against an already-enumerated edge list — callers caching
 * the shape's edges themselves (the sketch external-ref resolver keeps them per
 * source and pass) skip the repeat `findSubShapes` enumeration.
 */
export function matchEdgesInEdges(edges: readonly IEdge[], refs: EdgeRef[]): Result<number[]> {
    return edgeListMatcher(edges)(refs);
}

/**
 * `matchEdgesInEdges` split into capture and match: the fingerprints of a fixed
 * edge list are captured once and every returned match call reuses them, so
 * several refs geometrically matched against ONE edge list (a sketch resolving
 * its external refs on a single source) pay the per-edge capture once per
 * matcher instead of once per ref.
 */
export function edgeListMatcher(edges: readonly IEdge[]): (refs: EdgeRef[]) => Result<number[]> {
    if (edges.length === 0) return () => Result.err("Shape has no edges");
    // Captured once up front: scoring a live edge per (ref, edge) pair would pay
    // several kernel queries each. A degenerate edge fails the capture and is
    // skipped — it never matches.
    const captured = captureEdgeRefs(edges);
    return (refs) => {
        const perRef = matchCapturedRefs(captured, refs);
        return perRef.isOk ? Result.ok([...new Set(perRef.value)]) : Result.err(perRef.error);
    };
}

/**
 * The per-ref matched edge index (parallel to `refs`) — the scoring core of
 * `matchEdgeIndexes`/`matchEdgesAnchored`.
 */
function matchCapturedRefs(captured: CapturedEdgeRef[], refs: EdgeRef[]): Result<number[]> {
    const perRef: number[] = [];
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
        if (perRef.includes(best.index)) return Result.err("Edge match is ambiguous after rebuild");
        perRef.push(best.index);
    }
    return Result.ok(perRef);
}

/**
 * A moved edge counts as matched only when the runner-up is at least 50% farther away.
 * A sole candidate wins by default — unless its score is infinite, which means its
 * curve type does not match the ref at all.
 */
export function isClearWinner(bestScore: number, secondScore: number | undefined): boolean {
    if (!Number.isFinite(bestScore)) return false;
    return secondScore === undefined || secondScore > 1.5 * bestScore + MATCH_TOLERANCE;
}

function bestTwo(captured: CapturedEdgeRef[], ref: EdgeRef) {
    let best: { index: number; score: number } | undefined;
    let second: { index: number; score: number } | undefined;
    for (const { index, ref: candidate } of captured) {
        const score = refScoreRefs(ref, candidate);
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
 * matches at all (a degenerate edge scores Infinity too, see `refScore`). Unlike
 * `matchEdgeIndexes` this never accepts a "sole candidate": callers comparing
 * several candidate shapes need comparable scores, not a winner.
 */
export function bestEdgeScore(edges: IEdge[], ref: EdgeRef): number {
    let best = Infinity;
    for (const edge of edges) {
        best = Math.min(best, refScore(ref, edge));
    }
    return best;
}

/**
 * Scores a live edge by capturing its fingerprint first — the single scoring
 * formula lives in `refScoreRefs`. A degenerate edge (the capture throws) scores
 * Infinity: it never wins a scoring contest.
 */
export function refScore(ref: EdgeRef, edge: IEdge): number {
    try {
        return refScoreRefs(ref, captureEdgeRef(edge));
    } catch {
        return Infinity;
    }
}

export function vec3(xyz: XYZ): Vec3 {
    return { x: xyz.x, y: xyz.y, z: xyz.z };
}

export function distance(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Rebuilt axes may flip sign; compare both orientations. */
function axisDistance(a: Vec3, b: Vec3): number {
    return Math.min(distance(a, b), distance(a, { x: -b.x, y: -b.y, z: -b.z }));
}
