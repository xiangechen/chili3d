// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type IDocument,
    type IEdge,
    type IShape,
    Line,
    Matrix4,
    type Plane,
    Precision,
    type Result,
    ShapeTypes,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { edgeListMatcher } from "../features/edgeMatcher";
import {
    captureEdgeRef,
    type EdgeRef,
    edgeMatchesRefInvariant,
    isClearWinner,
    refScore,
    sameEdgeFingerprint,
} from "../features/edgeRef";
import { directionsParallel, MATCH_TOLERANCE, plainVec } from "../features/refGeometry";
import { indexesOfOverlappingId } from "../features/trackedId";
import { type ShapeSource, shapeSourceOf } from "./shapeSource";
import { type ExternalRefData, type SketchEntityType, toUV } from "./sketchModel";
import {
    ROLLED_BACK_SOURCE,
    resolveTimelineSource,
    SOURCE_UNAVAILABLE,
    type TimelineSourceOptions,
} from "./sourceTimeline";

/** Resolved sketch-plane geometry of an external edge. */
export interface ExternalSnapshot {
    type: SketchEntityType;
    /** Sketch UV params in the layout of `type` (see SketchEntityData). */
    params: number[];
}

export interface ExternalResolveResult {
    ref: ExternalRefData;
    /** The stored data changed (snapshot, type, dangling state or re-anchored fingerprint). */
    mutated: boolean;
    /** The resolved geometry or dangling state changed (drives shape rebuilds of profile refs). */
    geometryChanged: boolean;
}

/**
 * Sketch-UV geometry of a world-coordinate edge, or undefined when the curve
 * cannot be represented as a sketch entity: only lines and circles (full or
 * trimmed to an arc) are supported, and a circle's axis must be parallel to the
 * plane normal — otherwise its projection would be an ellipse.
 */
export function edgeSnapshotUV(plane: Plane, edge: IEdge): ExternalSnapshot | undefined {
    const basis = edge.curve.basisCurve;
    if (CurveUtils.isLine(basis)) {
        return { type: "line", params: [...toUV(plane, edge.startPoint()), ...toUV(plane, edge.endPoint())] };
    }
    if (!CurveUtils.isCircle(basis)) return undefined;
    const axis = basis.axis.normalize()!;
    if (!directionsParallel(axis, plane.normal)) return undefined;
    const [cu, cv] = toUV(plane, basis.center);
    if (edge.startPoint().distanceTo(edge.endPoint()) < Precision.Distance) {
        return { type: "circle", params: [cu, cv, basis.radius] };
    }
    let start = edge.startPoint();
    let end = edge.endPoint();
    // An anti-parallel axis reverses the apparent sweep; sketch arcs are always
    // counter-clockwise about the plane normal, so swap the trim points.
    if (axis.dot(plane.normal) < 0) [start, end] = [end, start];
    return { type: "arc", params: [cu, cv, ...toUV(plane, start), ...toUV(plane, end)] };
}

/**
 * Whether a world-coordinate edge lies on the sketch plane (a line: both
 * endpoints on the plane; a circle/arc: center on the plane and axis parallel
 * to the plane normal). Other curve kinds are never coplanar-projectable.
 */
export function isEdgeCoplanarWithPlane(plane: Plane, edge: IEdge): boolean {
    const basis = edge.curve.basisCurve;
    const onPlane = (point: XYZ) => point.distanceTo(plane.project(point)) <= Precision.Distance;
    if (CurveUtils.isLine(basis)) {
        return onPlane(edge.startPoint()) && onPlane(edge.endPoint());
    }
    if (CurveUtils.isCircle(basis)) {
        const axis = basis.axis.normalize()!;
        return directionsParallel(axis, plane.normal) && onPlane(basis.center);
    }
    return false;
}

/**
 * Captures a world-coordinate edge as an external reference, or undefined when
 * the edge cannot be represented as a sketch entity (see `edgeSnapshotUV`).
 */
export function captureExternalRef(
    entityId: number,
    nodeId: string,
    plane: Plane,
    worldEdge: IEdge,
    edgeId: string | undefined,
    role: ExternalRefData["role"],
): ExternalRefData | undefined {
    const snapshot = edgeSnapshotUV(plane, worldEdge);
    if (snapshot === undefined) return undefined;
    const edge = captureEdgeRef(worldEdge, edgeId);
    if (edge.kind === "other") return undefined;
    return { entityId, nodeId, edge, role, snapshot: snapshot.params, type: snapshot.type };
}

/**
 * Re-resolves every external reference against its source node, mutating the refs in place
 * (untransacted, refreshProfileRefs-style: snapshots and re-anchored fingerprints are derived
 * state).
 *
 * - **Dangling.** A ref whose edge can no longer be matched or represented keeps its last
 *   snapshot and is marked `dangling`; a recovered ref clears the flag.
 * - **Anchored sources.** A parametric-body source is read at the ref's timeline anchor
 *   (`anchors` — `SketchData.refPositions`, the body's feature count when the sketch first
 *   referenced it) whenever that anchor predates the body's current feature count. A downstream
 *   feature may have consumed the referenced edge (a cut into it), and resolving against the
 *   final shape would dangle — or worse, re-anchor the ref to a surviving split piece, breaking
 *   the sketch's profile loops. At the anchor the edge still exists, Onshape-style: one lost AT
 *   the anchor (its upstream geometry edited away) genuinely dangles, while one merely shortened
 *   there re-anchors to its new span.
 * - **Fallback.** A missing timeline state (the body not evaluated that far yet) falls back to
 *   the final shape.
 */
export interface ExternalResolveOptions extends TimelineSourceOptions {}

export function resolveExternalRefs(
    document: IDocument,
    plane: Plane,
    refs: ExternalRefData[],
    anchors?: Record<string, number>,
    options?: ExternalResolveOptions,
): ExternalResolveResult[] {
    // Each source node is resolved once per pass (findNode + findSubShapes are the
    // expensive part) and shared by every ref pointing at it — and by the split-piece
    // fallback, which needs the same edges resolveEdge just matched against. The
    // geometric fallback's edge fingerprints are likewise captured once per source
    // (SourceEdges.matchRefs), not once per ref.
    const sources = new Map<string, SourceLookup>();
    return refs.map((ref) => resolveExternalRef(document, plane, ref, sources, anchors, options));
}

function resolveExternalRef(
    document: IDocument,
    plane: Plane,
    ref: ExternalRefData,
    sources: Map<string, SourceLookup>,
    anchors: Record<string, number> | undefined,
    options: ExternalResolveOptions | undefined,
): ExternalResolveResult {
    const source = sourceEdgesCached(document, ref.nodeId, sources, anchors, options);
    if (source === ROLLED_BACK_SOURCE) return { ref, mutated: false, geometryChanged: false };
    if (source === undefined) return markDangling(ref);
    const resolved = resolveEdge(source, ref);
    if (resolved === undefined) {
        // The edge was split into pieces whose union still covers the stored curve
        // (e.g. a boolean cut consumed part of it). The underlying geometry is
        // unchanged, so keep the snapshot and the original full-span fingerprint —
        // future rebuilds re-match whether the edge stays split or re-merges. Only
        // the kernel edgeId is dead.
        if (coveredBySplitPieces(plane, ref, source)) return keepSplitCoverage(ref);
        return markDangling(ref);
    }
    return adoptResolvedEdge(plane, ref, source, resolved);
}

/**
 * Adopts a matched edge: re-anchors the fingerprint to the geometry actually
 * matched (the kernel edgeId travels with the ref — it identifies the edge, not
 * the geometry) and reports whether anything changed.
 */
function adoptResolvedEdge(
    plane: Plane,
    ref: ExternalRefData,
    source: SourceEdges,
    resolved: ResolvedEdge,
): ExternalResolveResult {
    try {
        // A geometric winner that is a strict piece of the stored span means a boolean
        // split the edge and this piece merely won the score race ([0,10] → [0,2]+[2,10]
        // scores 8 vs 2 — a clear winner): the whole-span policy above applies, so the
        // pieces get their coverage say before the ref re-anchors to the piece. Lines
        // only: matchEdgeIndexes scores circle fingerprints span-blind (center, radius,
        // axis), so same-circle pieces tie, fail as ambiguous and already reach the
        // coverage fallback — a sole sub-sweep winner can only be covered by itself.
        if (resolved.subSpan && coveredBySplitPieces(plane, ref, source)) return keepSplitCoverage(ref);
        const snapshot = edgeSnapshotUV(plane, resolved.edge);
        if (snapshot === undefined) return markDangling(ref);
        const fingerprint = captureEdgeRef(resolved.edge, ref.edge.edgeId);
        const geometryChanged =
            ref.dangling === true || ref.type !== snapshot.type || !sameParams(ref.snapshot, snapshot.params);
        const fingerprintChanged = !sameEdgeRef(ref.edge, fingerprint);
        ref.type = snapshot.type;
        ref.snapshot = snapshot.params;
        ref.edge = fingerprint;
        delete ref.dangling;
        return { ref, mutated: geometryChanged || fingerprintChanged, geometryChanged };
    } finally {
        if (resolved.owned) resolved.edge.dispose();
    }
}

/**
 * Split-piece coverage holds: keep the stored span and drop only the dead kernel edgeId.
 *
 * - **Why the id must go.** Dropping it is the only viable choice here — a full circle cut
 *   into two arcs leaves the id naming two pieces, and neither may claim the ref alone.
 * - **What bounces the next id hit differs by curve kind.** A LINE piece fails the span check
 *   (`idStillIdentifiesEdge` rejects strict sub-spans — lines only); a circle piece passes it
 *   (`refScore`'s circle branch is span-blind: center, radius, axis), so same-circle pieces tie
 *   0-0 and fail as ambiguous. The coverage fallback owns the case either way.
 * - **The erasure is permanent.** A later `adoptResolvedEdge` re-captures with the ref's stored
 *   id — undefined from here on — so no pass can bring the id back. The fingerprint plus coverage
 *   carries the identity from then on.
 */
function keepSplitCoverage(ref: ExternalRefData): ExternalResolveResult {
    const geometryChanged = ref.dangling === true;
    const fingerprintChanged = ref.edge.edgeId !== undefined;
    ref.edge.edgeId = undefined;
    delete ref.dangling;
    return { ref, mutated: geometryChanged || fingerprintChanged, geometryChanged };
}

/** The edge is gone or no longer representable: keep the last snapshot and mark the ref dangling. */
function markDangling(ref: ExternalRefData): ExternalResolveResult {
    const geometryChanged = ref.dangling !== true;
    ref.dangling = true;
    return { ref, mutated: geometryChanged, geometryChanged };
}

/** Field-exact fingerprint comparison — the change signal the old JSON round-trip computed. */
function sameEdgeRef(a: EdgeRef, b: EdgeRef): boolean {
    return a.edgeId === b.edgeId && sameEdgeFingerprint(a, b);
}

interface ResolvedEdge {
    /** The matched edge in world coordinates. */
    edge: IEdge;
    /** True when `edge` is a transformed copy owned by the caller (dispose it). */
    owned: boolean;
    /**
     * The match is collinear and strictly inside the stored span — a boolean split
     * the edge and this piece won the score race. Lines only (see resolveExternalRef).
     */
    subSpan: boolean;
}

/** The referenced edge on the source's shape, in world coordinates. */
function resolveEdge(source: SourceEdges, ref: ExternalRefData): ResolvedEdge | undefined {
    const { node, edges, transform } = source;
    // A timeline stand-in carries its own id lookup: the node's tracked ids describe
    // its final shape, never the stand-in's edges.
    const indexesOfId =
        source.indexesOfId ??
        (isBodyTrackingNode(node) ? (id: string) => node.edgeIndexesOfId(id) : undefined);
    const edgeId = ref.edge.edgeId;
    if (edgeId !== undefined && indexesOfId !== undefined) {
        const resolved = resolveByEdgeId(ref.edge, edgeId, edges, transform, indexesOfId);
        if (resolved !== undefined) return resolved;
    }
    return geometricEdgeMatch(source, ref.edge);
}

/**
 * Narrows the id hits to the one edge the ref belongs to.
 *
 * Several edges can carry the id — the pieces of a boolean-split edge share it, a collinear
 * merge compounds it — so a bare first hit can realign the ref onto a sibling piece. Every hit
 * that still carries the fingerprint's span therefore competes by span proximity: an exact span
 * wins outright, otherwise a sole candidate or a clear nearest keeps a rigid move following (the
 * pieces move together), and a genuine tie is handed to the geometric match.
 *
 * Hits failing the span/invariant check fall through as before: a strict sub-span means a
 * boolean split the referenced edge, which the caller's split-piece coverage owns.
 */
function resolveByEdgeId(
    ref: EdgeRef,
    edgeId: string,
    edges: IEdge[],
    transform: Matrix4,
    indexesOfId: (id: string) => number[],
): ResolvedEdge | undefined {
    const candidates: { edge: IEdge; owned: boolean; score: number }[] = [];
    for (const hit of indexesOfId(edgeId)) {
        const local = edges[hit];
        if (local === undefined) continue;
        const byId = worldEdge(local, transform);
        // Trust the id while the edge still carries the fingerprint's span: a rigid
        // move (an extrude length edit) only changes position, which is deliberately
        // not checked — moving IS the edit (same contract as resolveFacePlane, which
        // checks the face's normal but not its offset). A direction change means the
        // id realigned onto another edge.
        if (!idStillIdentifiesEdge(byId, ref)) {
            if (byId !== local) byId.dispose();
            continue;
        }
        let score: number;
        try {
            score = refScore(ref, byId);
        } catch {
            // A degenerate edge cannot claim the ref.
            if (byId !== local) byId.dispose();
            continue;
        }
        candidates.push({ edge: byId, owned: byId !== local, score });
    }
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0]!;
    const exact = candidates.filter((candidate) => candidate.score <= MATCH_TOLERANCE);
    const winner =
        exact.length === 1
            ? exact[0]!
            : exact.length === 0 && isClearWinner(best.score, candidates[1]?.score)
              ? best
              : undefined;
    for (const candidate of candidates) {
        if (candidate !== winner && candidate.owned) candidate.edge.dispose();
    }
    return winner === undefined ? undefined : { edge: winner.edge, owned: winner.owned, subSpan: false };
}

function worldEdge(edge: IEdge, transform: Matrix4): IEdge {
    if (transform.equals(Matrix4.identity())) return edge;
    return edge.transformedMul(transform) as IEdge;
}

function geometricEdgeMatch(source: SourceEdges, ref: EdgeRef): ResolvedEdge | undefined {
    const { edges, transform } = source;
    // The matcher hangs off the per-pass source entry: N refs taking the geometric
    // fallback on the same source share one edge enumeration (the pass's cached
    // list) and one fingerprint capture, instead of re-enumerating and
    // re-capturing per ref.
    source.matchRefs ??= edgeListMatcher(edges);
    const matched = source.matchRefs([localFingerprint(ref, transform)]);
    if (!matched.isOk) return undefined;
    const local = edges[matched.value[0]];
    const edge = worldEdge(local, transform);
    return { edge, owned: edge !== local, subSpan: ref.kind === "line" && isSubSpanOf(edge, ref) };
}

/**
 * The fingerprint in the source's local frame: refs store world coordinates but the
 * source's edges are local, so matching the stored fingerprint directly ties every
 * co-directional edge of a translated body (or double-applies the transform to the
 * winner). Points and axes inverse-transform; radius and length are rigid-invariant.
 */
function localFingerprint(ref: EdgeRef, transform: Matrix4): EdgeRef {
    if (transform.equals(Matrix4.identity())) return ref;
    const inverse = transform.invert();
    if (inverse === undefined) return ref;
    if (ref.kind === "line") {
        return {
            kind: "line",
            start: plainVec(inverse.ofPoint(ref.start)),
            end: plainVec(inverse.ofPoint(ref.end)),
            edgeId: ref.edgeId,
        };
    }
    if (ref.kind === "circle") {
        return {
            kind: "circle",
            center: plainVec(inverse.ofPoint(ref.center)),
            radius: ref.radius,
            axis: plainVec(inverse.ofVector(ref.axis)),
            edgeId: ref.edgeId,
        };
    }
    return { kind: "other", mid: plainVec(inverse.ofPoint(ref.mid)), length: ref.length, edgeId: ref.edgeId };
}

/**
 * Whether an id-tracked edge still is the fingerprint's edge: the rigid-move
 * invariants hold (`edgeMatchesRefInvariant` — direction/axis/length, position
 * deliberately unchecked) and the edge is not a strict sub-span of the stored span,
 * which would mean a boolean split it into pieces (split-piece coverage owns that
 * case).
 */
function idStillIdentifiesEdge(edge: IEdge, ref: EdgeRef): boolean {
    if (!edgeMatchesRefInvariant(edge, ref)) return false;
    if (ref.kind === "line") return !isSubSpanOf(edge, ref);
    return true;
}

/** A split piece is collinear and strictly inside the stored span; a moved or extended edge is not. */
function isSubSpanOf(edge: IEdge, ref: { start: XYZLike; end: XYZLike }): boolean {
    const start = new XYZ(ref.start);
    const direction = new XYZ(ref.end).sub(start);
    const length = direction.length();
    if (length < Precision.Distance) return false;
    const unit = direction.multiply(1 / length);
    const lo = edge.startPoint().sub(start).dot(unit);
    const hi = edge.endPoint().sub(start).dot(unit);
    const [a, b] = lo < hi ? [lo, hi] : [hi, lo];
    const contained = a >= -MATCH_TOLERANCE && b <= length + MATCH_TOLERANCE;
    return contained && b - a < length - MATCH_TOLERANCE;
}

interface SourceEdges extends ShapeSource {
    edges: IEdge[];
    /**
     * Lazily-built reusable matcher over `edges` (`edgeListMatcher`): every ref
     * taking the geometric fallback on this source shares one fingerprint capture
     * per pass instead of capturing (and enumerating) per ref.
     */
    matchRefs?: (refs: EdgeRef[]) => Result<number[]>;
    /**
     * Id lookup of a timeline stand-in shape (set whenever the source is read at a
     * sketch's anchor instead of its final shape): built from the stand-in's own
     * tracked ids, returning empty for every id when tracking is unavailable —
     * the node's final-shape ids must never index into the stand-in's edges.
     */
    indexesOfId?: (id: string) => number[];
}

type SourceLookup = SourceEdges | undefined | typeof ROLLED_BACK_SOURCE;

/**
 * The source node with its resolution shape, edges and world transform, or
 * undefined when unavailable. Which shape that is — a timeline stand-in, the final
 * shape, or nothing at all because the source is frozen — is settled by
 * `resolveTimelineSource`; this only re-bases the winner onto edges.
 *
 * A stand-in carries its own id lookup: the node's tracked ids describe its final
 * shape only, so they must never index into the stand-in's edges.
 */
function sourceEdges(
    document: IDocument,
    nodeId: string,
    anchors: Record<string, number> | undefined,
    options: ExternalResolveOptions | undefined,
): SourceLookup {
    const source = resolveTimelineSource(document, nodeId, anchors?.[nodeId], {
        includeRolledBackSources: options?.includeRolledBackSources,
        usable: hasEdges,
    });
    if (source === ROLLED_BACK_SOURCE) return ROLLED_BACK_SOURCE;
    if (source === SOURCE_UNAVAILABLE) return undefined;

    const edges = source.shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const base = shapeSourceOf(document, source.node, source.shape);
    if (!source.standIn) return { ...base, edges };
    const ids = source.edgeIds;
    return {
        ...base,
        edges,
        indexesOfId: (id: string) => (ids === undefined ? [] : indexesOfOverlappingId(ids, id)),
    };
}

/** A stand-in with nothing to match against is worse than the final shape. */
function hasEdges(shape: IShape): boolean {
    return (shape.findSubShapes(ShapeTypes.edge) as IEdge[]).length > 0;
}

/** `sourceEdges` memoized per pass — several refs (and the coverage fallback) share a source. */
function sourceEdgesCached(
    document: IDocument,
    nodeId: string,
    cache: Map<string, SourceLookup>,
    anchors: Record<string, number> | undefined,
    options: ExternalResolveOptions | undefined,
): SourceLookup {
    if (!cache.has(nodeId)) cache.set(nodeId, sourceEdges(document, nodeId, anchors, options));
    return cache.get(nodeId);
}

/**
 * Last fallback when no single edge matches: the referenced edge may have been
 * split into collinear/cocircular pieces by a boolean. True when the union of the
 * pieces' spans covers the stored fingerprint's span — the edge still exists
 * geometrically, just fragmented.
 */
function coveredBySplitPieces(
    plane: Plane,
    ref: ExternalRefData,
    source: { edges: IEdge[]; transform: Matrix4 },
): boolean {
    let edges = source.edges;
    let owned: IEdge[] = [];
    if (!source.transform.equals(Matrix4.identity())) {
        owned = edges.map((edge) => edge.transformedMul(source.transform) as IEdge);
        edges = owned;
    }
    try {
        if (ref.edge.kind === "line") return lineSplitCovers(ref.edge, edges);
        if (ref.edge.kind === "circle") return circleSplitCovers(plane, ref, edges);
        return false;
    } finally {
        for (const edge of owned) edge.dispose();
    }
}

/** True when collinear pieces of `edges` together cover the stored line's span. */
function lineSplitCovers(ref: { start: XYZLike; end: XYZLike }, edges: IEdge[]): boolean {
    const start = new XYZ(ref.start);
    const end = new XYZ(ref.end);
    const direction = end.sub(start).normalize();
    if (direction === undefined) return false;
    const spans: [number, number][] = [];
    for (const edge of edges) {
        const basis = edge.curve.basisCurve;
        if (!CurveUtils.isLine(basis)) continue;
        const edgeStart = edge.startPoint();
        const edgeDirection = edge.endPoint().sub(edgeStart).normalize();
        if (edgeDirection === undefined || !directionsParallel(edgeDirection, direction)) {
            continue;
        }
        // collinear: both stored endpoints (nearly) on the candidate's infinite line
        const line = new Line({ point: edgeStart, direction: edgeDirection });
        if (line.nearestToPoint(start).distanceTo(start) > MATCH_TOLERANCE) continue;
        if (line.nearestToPoint(end).distanceTo(end) > MATCH_TOLERANCE) continue;
        let lo = edgeStart.sub(start).dot(direction);
        let hi = edge.endPoint().sub(start).dot(direction);
        if (lo > hi) [lo, hi] = [hi, lo];
        spans.push([lo, hi]);
    }
    return coversSpan(spans, 0, start.distanceTo(end), Precision.Distance);
}

/** True when cocircular pieces of `edges` together cover the stored arc's sweep. */
function circleSplitCovers(plane: Plane, ref: ExternalRefData, edges: IEdge[]): boolean {
    if (ref.edge.kind !== "circle") return false;
    const stored = ref.edge;
    const center = new XYZ(stored.center);
    const axis = new XYZ(stored.axis).normalize();
    if (axis === undefined) return false;
    const candidates = edges.filter((edge) => {
        const basis = edge.curve.basisCurve;
        if (!CurveUtils.isCircle(basis)) return false;
        if (basis.center.distanceTo(center) > MATCH_TOLERANCE) return false;
        if (Math.abs(basis.radius - stored.radius) > MATCH_TOLERANCE) return false;
        const candidateAxis = basis.axis.normalize();
        return candidateAxis !== undefined && directionsParallel(candidateAxis, axis);
    });
    if (candidates.length === 0) return false;
    // A full circle is covered by any piece of the same circle.
    if (ref.type === "circle") return true;
    if (ref.type !== "arc") return false;

    const { sweep, spans } = arcCoverageSpans(plane, ref, candidates);
    return coversSpan(spans, 0, sweep, Precision.Distance / Math.max(ref.edge.radius, Precision.Distance));
}

/**
 * Angular coverage of the stored arc by `candidates`, in the sketch frame: the
 * snapshot arc runs counter-clockwise about the plane normal (see edgeSnapshotUV),
 * so candidates are normalized the same way.
 */
function arcCoverageSpans(
    plane: Plane,
    ref: ExternalRefData,
    candidates: IEdge[],
): { sweep: number; spans: [number, number][] } {
    const [cu, cv, su, sv, eu, ev] = ref.snapshot;
    const angleOf = (point: XYZ) => {
        const [u, v] = toUV(plane, point);
        return Math.atan2(v - cv, u - cu);
    };
    const a0 = Math.atan2(sv - cv, su - cu);
    let sweep = ccw(Math.atan2(ev - cv, eu - cu) - a0);
    if (sweep <= 0) sweep = Math.PI * 2;
    const spans: [number, number][] = [];
    for (const edge of candidates) {
        let start = edge.startPoint();
        let end = edge.endPoint();
        const basis = edge.curve.basisCurve;
        if (CurveUtils.isCircle(basis) && basis.axis.normalize()!.dot(plane.normal) < 0) {
            [start, end] = [end, start];
        }
        // a candidate spanning the full circle covers everything
        if (start.distanceTo(end) < Precision.Distance) {
            return { sweep: Math.PI * 2, spans: [[0, Math.PI * 2]] };
        }
        const lo = ccw(angleOf(start) - a0);
        const arcSweep = ccw(angleOf(end) - angleOf(start));
        // the doubled span covers arcs crossing the stored start angle
        spans.push([lo, lo + arcSweep], [lo - Math.PI * 2, lo + arcSweep - Math.PI * 2]);
    }
    return { sweep, spans };
}

/** Counter-clockwise angle normalized to [0, 2π). */
function ccw(angle: number): number {
    return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

/** True when `spans` merge into an interval covering [lo, hi], gaps up to `tolerance` ignored. */
function coversSpan(spans: [number, number][], lo: number, hi: number, tolerance: number): boolean {
    const ordered = [...spans].sort((a, b) => a[0] - b[0]);
    let covered = lo;
    for (const [spanLo, spanHi] of ordered) {
        if (spanLo > covered + tolerance) return false;
        covered = Math.max(covered, spanHi);
        if (covered >= hi - tolerance) return true;
    }
    return covered >= hi - tolerance;
}

function sameParams(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
