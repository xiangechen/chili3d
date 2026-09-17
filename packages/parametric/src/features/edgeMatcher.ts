// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IShape, Result, ShapeTypes } from "@chili3d/core";
import {
    captureEdgeRef,
    type EdgeRef,
    edgeMatchesRefInvariant,
    isClearWinner,
    refScore,
    refScoreRefs,
} from "./edgeRef";
import { MATCH_TOLERANCE } from "./refGeometry";
import { ID_COMPONENT_SEPARATOR, idIsShared, idsOverlap } from "./trackedId";

/**
 * Re-finding stored edge references on a rebuilt shape.
 *
 * A stored `EdgeRef` (see `edgeRef.ts` for the fingerprint format) has two channels to
 * be recognised through, tried in that order:
 *
 * 1. **The tracked id**, when the ref carries one. Hits are adopted as a whole span —
 *    a boolean may have split the edge, and every piece sharing the id is still the
 *    edge the user picked. A hit that no longer keeps the fingerprint's rigid-move
 *    invariants is not trusted, and demotes to channel 2.
 * 2. **The geometric fingerprint**, for refs with no id and for refs whose id is gone
 *    or was demoted. The closest candidate wins only when it is *clearly* closest —
 *    otherwise the match is ambiguous and the caller must re-pick rather than risk
 *    rounding the wrong edge.
 *
 * Entry points, all taking a set of refs:
 * - `matchEdgeIndexes` — indexes into a shape's `findSubShapes(edge)` order. The plain one.
 * - `matchEdgesInEdges` / `edgeListMatcher` — the same against an already-enumerated
 *   edge array; the latter pre-captures that array's fingerprints for repeated matching.
 * - `matchEdgesAnchored` — the same, but also returning the anchors each ref actually
 *   matched, for the body to write back (see `AnchoredEdgeMatch`).
 */

/**
 * The matched edge indexes of `matchEdgesAnchored`, plus per-ref anchors refreshed to what each
 * ref actually matched this run.
 *
 * - **The re-anchoring contract** (the `resolvedProfiles` one, applied to edge refs). A ref
 *   whose stored id is GONE from the rebuilt shape (or never had one) and recovered
 *   geometrically is re-captured from the matched edge — fresh fingerprint, the edge's current
 *   id, `splitPiece` when that id is shared by several edges. The body writes it back
 *   untransacted, so a later rebuild resolves by id again instead of re-paying (and risking)
 *   fingerprint matching with a dead id.
 * - **Two kinds of refs pass through unchanged**, both deliberately:
 *   - id-hit refs — a live id is already the freshest anchor, and rewriting it to an
 *     overlapping compound id (the edge merged with another) would silently widen the ref
 *     beyond its picked span when the merge re-splits;
 *   - refs whose id is still ALIVE but failed the invariant check this run (a merged free-form
 *     curve whose length changed) — rewriting those would sever the ref from its original edge,
 *     which can claim it back once the invariant holds again, and could stamp a `splitPiece`
 *     the user never picked.
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
 * Like `matchEdgeIndexes`, but a ref carrying an `edgeId` resolves through the stable id first.
 *
 * Every input edge whose id intersects the ref's (`idsOverlap`) **and** still keeps the
 * fingerprint's rigid-move invariants (`edgeMatchesRefInvariant`) is adopted — the whole
 * span, which is what an edge feature picked on a split or merged edge means:
 * - several hits are the pieces of an edge a boolean split (feature-scoped ids are unique per
 *   rebuild, so a duplicated id can only come from one-to-many derivation), or the pieces of a
 *   re-split merge (a fused collinear edge carries a compound of its ancestors' ids);
 * - a single hit is the ordinary case.
 *
 * An id that is gone — or whose edge no longer keeps the invariants (a positional id realigned
 * onto another edge; a merged free-form curve, whose length changed) — demotes the ref to
 * fingerprint matching.
 *
 * Narrowing: when exactly ONE of several hits still matches the fingerprint within
 * MATCH_TOLERANCE, the ref was captured from just that piece of an already split edge, so only
 * that piece is adopted — the whole span would silently widen the feature beyond what was
 * picked. Zero exact matches means the ref covered the whole edge (its pieces only approximate
 * the span), or the geometry moved and every piece fails the stale fingerprint; several exact
 * matches means coincident pieces. Both keep whole-span adoption.
 *
 * A ref flagged `splitPiece` was by definition captured from one piece and never widens: zero
 * exact matches adopts the clearly closest piece (`isClearWinner` — the same rule moved-geometry
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
        const recovered = recoverByFingerprint(edges, refs, remaining, inputEdgeIds, resolved);
        if (!recovered.isOk) return Result.err(recovered.error);
        for (const [refIndex, anchor] of recovered.value) {
            anchors[refIndex] = anchor;
        }
    }
    return Result.ok({ indexes: [...resolved], anchors: anchors as EdgeRef[] });
}

/** Fingerprint pass over the refs whose id missed; claims each matched index in `resolved`. */
function recoverByFingerprint(
    edges: IEdge[],
    refs: EdgeRef[],
    remaining: number[],
    inputEdgeIds: readonly string[],
    resolved: Set<number>,
): Result<Map<number, EdgeRef>> {
    if (edges.length === 0) return Result.err("Shape has no edges");
    // Captured once: every remaining ref is scored against every capturable
    // edge; each entry keeps its edge's original index.
    const captured = captureEdgeRefs(edges);
    const perRef = matchCapturedRefs(
        captured,
        remaining.map((index) => refs[index]),
    );
    if (!perRef.isOk) return Result.err(perRef.error);

    const anchors = new Map<number, EdgeRef>();
    for (const [k, refIndex] of remaining.entries()) {
        const edgeIndex = perRef.value[k];
        if (resolved.has(edgeIndex)) return Result.err("Edge match is ambiguous after rebuild");
        resolved.add(edgeIndex);
        anchors.set(
            refIndex,
            reanchorRecoveredRef(refs[refIndex], edges[edgeIndex], inputEdgeIds, edgeIndex),
        );
    }
    return Result.ok(anchors);
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
    const componentIndex = () => (byComponent ??= indexByIdComponent(inputEdgeIds, edges.length));

    for (const [refIndex, ref] of refs.entries()) {
        const hits = idHits(edges, ref, componentIndex);
        if (hits.length === 0) {
            remaining.push(refIndex);
            continue;
        }
        const adopted = adoptHits(hits, edges, ref, resolved);
        if (!adopted.isOk) return Result.err(adopted.error);
        for (const index of adopted.value) {
            resolved.add(index);
        }
    }
    return Result.ok({ resolved, remaining });
}

/** Indexes of the edges whose id overlaps the ref's and which still satisfy its invariant. */
function idHits(edges: IEdge[], ref: EdgeRef, componentIndex: () => Map<string, number[]>): number[] {
    if (ref.edgeId === undefined) return [];

    const hits: number[] = [];
    for (const index of overlappingIndexes(componentIndex(), ref.edgeId)) {
        if (keepsInvariant(edges[index], ref)) {
            hits.push(index);
        }
    }
    return hits;
}

/** Narrows the id hits to the piece actually picked, refusing one another ref already holds. */
function adoptHits(hits: number[], edges: IEdge[], ref: EdgeRef, resolved: Set<number>): Result<number[]> {
    const adopted = singleExactHit(hits, edges, ref);
    if (!adopted.isOk) return Result.err(adopted.error);
    if (adopted.value.some((index) => resolved.has(index))) {
        return Result.err("Edge match is ambiguous after rebuild");
    }
    return Result.ok(adopted.value);
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
