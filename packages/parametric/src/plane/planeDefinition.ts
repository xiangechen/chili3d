// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type IDocument,
    type IEdge,
    type IShape,
    type IVertex,
    Matrix4,
    Plane,
    Precision,
    Result,
    ShapeTypes,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { matchEdgeIndexes, matchEdgesAnchored } from "../features/edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type { NeutralPlaneRef } from "../features/feature";
import { distance, MATCH_TOLERANCE, plainVec } from "../features/refGeometry";
import { matchVertex, type VertexRef } from "../features/vertexRef";
import { worldAxisXVec } from "../sketch/planeRef";
import { shapeSourceOf } from "../sketch/shapeSource";
import {
    ROLLED_BACK_SOURCE,
    resolveTimelineSource,
    SOURCE_UNAVAILABLE,
    type TimelineSource,
} from "../sketch/sourceTimeline";
import { resolvePlaneSourceInWorld } from "./planeSource";

/**
 * A stable identity for a vertex on an edge: the edge's fingerprint plus which END the
 * vertex is, and both captured endpoint positions (so a rebuild that flips the edge's
 * parameterization still names the same physical end). A vertex usually has two or three
 * incident edges; all are kept, and the first that re-matches wins.
 */
export interface VertexAnchor {
    readonly edge: EdgeRef;
    /** 0 = the edge's start, 1 = its end. */
    readonly end: 0 | 1;
    /** Both endpoints as captured, in the source node's local frame. */
    readonly ends: readonly [XYZLike, XYZLike];
}

/**
 * A vertex a plane definition runs through. `vertex` is the positional fallback in the
 * source node's LOCAL frame; `incident` is the topology-based identity that survives an
 * upstream parameter edit moving the vertex. Without an incident edge (or when it is
 * lost), resolution falls back to the positional match.
 */
export interface PointRef {
    readonly nodeId: string;
    readonly vertex: VertexRef;
    readonly incident?: readonly VertexAnchor[];
}

/**
 * The incident edges that name `vertex`, captured from `shape` (the source node's LOCAL
 * shape). `edgeIdAt` supplies a parametric body's tracked edge ids; other nodes fall back
 * to the geometric fingerprint. Up to four anchors are kept — a solid corner has two or
 * three, and one surviving edge is enough.
 */
export function captureVertexAnchors(
    shape: IShape,
    vertex: IVertex,
    edgeIdAt?: (index: number) => string | undefined,
): VertexAnchor[] | undefined {
    let point: XYZ;
    try {
        point = vertex.point();
    } catch {
        return undefined;
    }
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const anchors: VertexAnchor[] = [];
    for (const [index, edge] of edges.entries()) {
        let start: XYZ;
        let end: XYZ;
        try {
            start = edge.startPoint();
            end = edge.endPoint();
        } catch {
            continue;
        }
        const atStart = start.distanceTo(point) <= MATCH_TOLERANCE;
        const atEnd = end.distanceTo(point) <= MATCH_TOLERANCE;
        if (!atStart && !atEnd) continue;
        try {
            anchors.push({
                edge: captureEdgeRef(edge, edgeIdAt?.(index)),
                end: atStart ? 0 : 1,
                ends: [plainVec(start), plainVec(end)],
            });
        } catch {
            // A degenerate edge cannot name a vertex.
        }
        if (anchors.length >= 4) break;
    }
    return anchors.length === 0 ? undefined : anchors;
}

/** An edge a plane definition takes its direction/curve from, captured in world coordinates. */
export interface EdgeSourceRef {
    readonly nodeId: string;
    readonly edge: EdgeRef;
}

/** Fields every definition carries: the timeline positions its refs were captured at. */
interface PlaneDefinitionBase {
    /**
     * For each source node that is a parametric body, the feature-list index its geometry
     * was captured against. Resolution reads the node's shape AT that position, so a
     * feature added afterwards neither drags the datum plane nor creates a rebuild cycle.
     */
    readonly anchors?: Readonly<Record<string, number>>;
    /** Reverses the constructed plane's normal without moving it. */
    readonly flip?: boolean;
    /**
     * A point of the plane near what it was made from (a face click, a picked point, a
     * line's start). The display square is drawn around it when no sketch is bound — the
     * plane's frame origin is the world origin's projection and can be far away.
     */
    readonly anchor?: XYZLike;
}

/**
 * How a user-created datum plane is defined. Every geometric reference is captured in
 * world coordinates; a rebuild re-matches it on the source node's current geometry (at
 * its captured timeline anchor).
 */
export type PlaneDefinition =
    | ({
          readonly kind: "offset";
          readonly source: NeutralPlaneRef;
          readonly distance: number;
          /** Offset to the other side of the source plane (Onshape's opposite direction). */
          readonly reverse?: boolean;
      } & PlaneDefinitionBase)
    | ({
          readonly kind: "planePoint";
          readonly source: NeutralPlaneRef;
          readonly point: PointRef;
      } & PlaneDefinitionBase)
    | ({
          readonly kind: "lineAngle";
          readonly line: EdgeSourceRef;
          readonly reference: NeutralPlaneRef;
          readonly angle: number;
          /** The captured line direction, so a rebuild's flipped parameterization keeps the angle's sense. */
          readonly direction?: XYZLike;
      } & PlaneDefinitionBase)
    | ({
          readonly kind: "pointNormal";
          readonly axis: EdgeSourceRef;
          readonly point: PointRef;
          /** The captured axis direction, so a flipped edge parameterization keeps the normal's sign. */
          readonly direction?: XYZLike;
      } & PlaneDefinitionBase)
    | ({
          readonly kind: "threePoint";
          readonly points: readonly [PointRef, PointRef, PointRef];
      } & PlaneDefinitionBase)
    | ({
          readonly kind: "midPlane";
          readonly first: NeutralPlaneRef;
          readonly second: NeutralPlaneRef;
      } & PlaneDefinitionBase)
    | ({
          readonly kind: "curvePoint";
          readonly curve: EdgeSourceRef;
          /** Selects the nearest point on the curve; the plane passes through that point. */
          readonly point: PointRef;
          /** The captured tangent, so a rebuild's flipped curve direction does not flip the normal. */
          readonly tangent?: XYZLike;
      } & PlaneDefinitionBase);

/**
 * The plane's frame from the plane ALONE: its origin and normal determine the in-plane
 * X axis (world-up rule), exactly as a sketch on a flat face does. This is what keeps a
 * construction plane's frame still when a pick order, an edge parameterization or a
 * source plane's own arbitrary X axis changes underneath it.
 */
function canonicalFrame(origin: XYZ, normal: XYZ): Plane {
    const n = normal.normalize();
    if (n === undefined) throw new Error("Plane normal is degenerate");
    return new Plane({ origin, normal: n, xvec: worldAxisXVec(n) });
}

/** `flip` reverses the plane's normal; the frame is then rebuilt from the new normal. */
function applyFlip(plane: Plane, flip: boolean | undefined): Plane {
    if (flip !== true) return plane;
    return canonicalFrame(plane.origin, plane.normal.reverse());
}

/** A plane through `point` whose normal is `normal`, with a stable, Z-up in-plane X axis. */
function planeAtPoint(point: XYZ, normal: XYZ): Result<Plane> {
    const n = normal.normalize();
    if (n === undefined) return Result.err("Plane normal is degenerate");
    return Result.ok(canonicalFrame(point, n));
}

/**
 * Resolves a definition against the document's current geometry. The returned plane is in
 * world coordinates; `PlaneNode` maps it into its own frame before building the display
 * rectangle.
 */
export function resolvePlaneDefinition(
    definition: PlaneDefinition,
    document: IDocument,
    visited?: ReadonlySet<string>,
): Result<Plane> {
    // Kernel queries (a degenerate edge's `curve`, a null face normal, ...) throw JS Errors
    // by design; a datum plane must fail as a value, never tear down the caller's rebuild.
    try {
        switch (definition.kind) {
            case "offset":
                return offsetDefinition(definition, document, visited);
            case "planePoint":
                return planePointDefinition(definition, document, visited);
            case "lineAngle":
                return lineAngleDefinition(definition, document, visited);
            case "pointNormal":
                return pointNormalDefinition(definition, document, visited);
            case "threePoint":
                return threePointDefinition(definition, document, visited);
            case "midPlane":
                return midPlaneDefinition(definition, document, visited);
            case "curvePoint":
                return curvePointDefinition(definition, document, visited);
            default:
                return Result.err(
                    `Unknown plane definition: ${String((definition as { kind?: string }).kind)}`,
                );
        }
    } catch (error) {
        return Result.err(`Plane definition could not be resolved: ${String(error)}`);
    }
}

function sourcePlane(
    document: IDocument,
    ref: NeutralPlaneRef,
    anchors: PlaneDefinitionBase["anchors"],
    label: string,
    visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    return resolvePlaneSourceInWorld(document, ref, anchors, { label, visited });
}

function offsetDefinition(
    definition: Extract<PlaneDefinition, { kind: "offset" }>,
    document: IDocument,
    visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    if (!Number.isFinite(definition.distance)) {
        return Result.err("Plane offset distance is not a finite number");
    }
    const source = sourcePlane(document, definition.source, definition.anchors, "Plane", visited);
    if (!source.isOk) return source;
    const distance = definition.reverse === true ? -definition.distance : definition.distance;
    const offsetted = source.value.offsetAlongNormal(distance);
    return Result.ok(applyFlip(canonicalFrame(offsetted.origin, offsetted.normal), definition.flip));
}

function planePointDefinition(
    definition: Extract<PlaneDefinition, { kind: "planePoint" }>,
    document: IDocument,
    visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    const source = sourcePlane(document, definition.source, definition.anchors, "Plane", visited);
    if (!source.isOk) return source;
    const point = resolvePoint(document, definition.point, definition.anchors, "Plane");
    if (!point.isOk) return Result.err(point.error);
    return Result.ok(applyFlip(canonicalFrame(point.value, source.value.normal), definition.flip));
}

function pointNormalDefinition(
    definition: Extract<PlaneDefinition, { kind: "pointNormal" }>,
    document: IDocument,
    _visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    const point = resolvePoint(document, definition.point, definition.anchors, "Plane");
    if (!point.isOk) return Result.err(point.error);
    const axis = withEdge(document, definition.axis, definition.anchors, "Plane", (edge, transform) => {
        const resolved = axisOfEdge(edge);
        if (!resolved.isOk || definition.direction === undefined) return resolved;
        // The captured direction lives in the source's LOCAL frame, like the edge ref.
        const captured = transform.ofVector(new XYZ(definition.direction));
        return Result.ok(resolved.value.dot(captured) < 0 ? resolved.value.reverse() : resolved.value);
    });
    if (!axis.isOk) return Result.err(axis.error);
    const plane = planeAtPoint(point.value, axis.value);
    return plane.isOk ? Result.ok(applyFlip(plane.value, definition.flip)) : plane;
}

function lineAngleDefinition(
    definition: Extract<PlaneDefinition, { kind: "lineAngle" }>,
    document: IDocument,
    visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    if (!Number.isFinite(definition.angle)) {
        return Result.err("Plane angle is not a finite number");
    }
    const line = withEdge(document, definition.line, definition.anchors, "Plane", (edge, transform) => {
        if (!isLineEdge(edge)) return Result.err("Line angle requires a straight edge");
        let start = edge.startPoint();
        let end = edge.endPoint();
        let direction = end.sub(start);
        // The captured direction is in the source's LOCAL frame; a rebuild may return the
        // same geometric edge with a flipped parameterization. Aligning the direction must
        // also move the origin to what was the captured start, or the plane origin jumps
        // to the other end of the line.
        const captured =
            definition.direction === undefined
                ? undefined
                : transform.ofVector(new XYZ(definition.direction));
        if (captured !== undefined && direction.dot(captured) < 0) {
            [start, end] = [end, start];
            direction = direction.reverse();
        }
        return Result.ok({ point: start, direction });
    });
    if (!line.isOk) return Result.err(line.error);
    const reference = sourcePlane(document, definition.reference, definition.anchors, "Plane", visited);
    if (!reference.isOk) return Result.err(reference.error);
    return lineAnglePlane(
        line.value.point,
        line.value.direction,
        reference.value,
        definition.angle,
        undefined,
        definition.flip,
    );
}

function threePointDefinition(
    definition: Extract<PlaneDefinition, { kind: "threePoint" }>,
    document: IDocument,
    _visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    const points: XYZ[] = [];
    for (const ref of definition.points) {
        const point = resolvePoint(document, ref, definition.anchors, "Plane");
        if (!point.isOk) return Result.err(point.error);
        points.push(point.value);
    }
    return threePointPlane(points[0], points[1], points[2], definition.flip);
}

function midPlaneDefinition(
    definition: Extract<PlaneDefinition, { kind: "midPlane" }>,
    document: IDocument,
    visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    const first = sourcePlane(document, definition.first, definition.anchors, "Plane", visited);
    if (!first.isOk) return first;
    const second = sourcePlane(document, definition.second, definition.anchors, "Plane", visited);
    if (!second.isOk) return second;
    return midPlaneOf(first.value, second.value, definition.flip);
}

function curvePointDefinition(
    definition: Extract<PlaneDefinition, { kind: "curvePoint" }>,
    document: IDocument,
    _visited: ReadonlySet<string> | undefined,
): Result<Plane> {
    const point = resolvePoint(document, definition.point, definition.anchors, "Plane");
    if (!point.isOk) return Result.err(point.error);
    const tangent = withNearestCurve(
        document,
        definition.curve,
        definition.anchors,
        point.value,
        "Plane",
        (edge) => {
            const nearest = edge.curve.nearestFromPoint(point.value);
            const derivative = edge.curve.d1(nearest.parameter);
            const direction = derivative.vec.normalize();
            return direction === undefined
                ? Result.err("Curve tangent is degenerate")
                : Result.ok({ direction, origin: nearest.point });
        },
    );
    if (!tangent.isOk) return Result.err(tangent.error);
    // The picked point selects WHERE along the curve; the plane passes through that curve
    // point, so an off-curve pick cannot build geometry unrelated to the curve.
    return curvePointPlane(
        tangent.value.origin,
        tangent.value.direction,
        definition.tangent,
        definition.flip,
    );
}

// ---------------------------------------------------------------------------------------
// Pure math. Exported so the construction rules can be unit-tested without a document.
// ---------------------------------------------------------------------------------------

export function lineAnglePlane(
    linePoint: XYZ,
    lineDirection: XYZ,
    reference: Plane,
    angleDegrees: number,
    capturedDirection: XYZLike | undefined,
    flip: boolean | undefined,
): Result<Plane> {
    let direction = lineDirection.normalize();
    if (direction === undefined) return Result.err("Line direction is degenerate");
    if (capturedDirection !== undefined && direction.dot(new XYZ(capturedDirection)) < 0) {
        direction = direction.reverse();
    }
    const referenceNormal = reference.normal.normalize();
    if (referenceNormal === undefined) return Result.err("Reference plane normal is degenerate");
    const perpendicular = referenceNormal.sub(direction.multiply(referenceNormal.dot(direction))).normalize();
    if (perpendicular === undefined) {
        return Result.err("Line is parallel to the reference plane normal");
    }
    const normal = perpendicular.rotate(direction, (angleDegrees * Math.PI) / 180);
    if (normal === undefined) return Result.err("Plane normal is degenerate");
    return Result.ok(applyFlip(canonicalFrame(linePoint, normal), flip));
}

export function threePointPlane(
    first: XYZ,
    second: XYZ,
    third: XYZ,
    flip: boolean | undefined,
): Result<Plane> {
    const x = second.sub(first).normalize();
    const normal = second.sub(first).cross(third.sub(first)).normalize();
    if (x === undefined || normal === undefined) {
        return Result.err("Three points are collinear");
    }
    return Result.ok(applyFlip(canonicalFrame(first, normal), flip));
}

export function midPlaneOf(first: Plane, second: Plane, flip: boolean | undefined): Result<Plane> {
    const dot = first.normal.dot(second.normal);
    if (Math.abs(Math.abs(dot) - 1) <= 1e-6) return parallelMidPlane(first, second, flip);
    return bisectorPlane(first, second, dot, flip);
}

function parallelMidPlane(first: Plane, second: Plane, flip: boolean | undefined): Result<Plane> {
    const normal = first.normal;
    const firstOffset = normal.dot(first.origin);
    const secondOffset = normal.dot(second.origin);
    if (Math.abs(secondOffset - firstOffset) <= Precision.Distance) {
        return Result.err("The two planes are coincident");
    }
    const origin = first.origin.add(normal.multiply((secondOffset - firstOffset) / 2));
    return Result.ok(applyFlip(canonicalFrame(origin, normal), flip));
}

/**
 * One of the two bisectors of intersecting planes: the normals add (or, with `flip`,
 * subtract); the frame is then rebuilt from the resulting normal, so it depends on the
 * plane alone. Onshape's control for this case is "Flip alignment", which switches WHICH
 * bisector is built — not the normal direction of one of them.
 */
function bisectorPlane(first: Plane, second: Plane, dot: number, flip: boolean | undefined): Result<Plane> {
    const secondNormal = dot < 0 ? second.normal.reverse() : second.normal;
    const combined = flip === true ? first.normal.sub(secondNormal) : first.normal.add(secondNormal);
    const normal = combined.normalize();
    const line = first.normal.cross(second.normal).normalize();
    if (normal === undefined || line === undefined) return Result.err("The two planes do not intersect");
    const denominator = 1 - dot * dot;
    const firstOffset = first.normal.dot(first.origin);
    const secondOffset = second.normal.dot(second.origin);
    const origin = first.normal
        .multiply((firstOffset - secondOffset * dot) / denominator)
        .add(second.normal.multiply((secondOffset - firstOffset * dot) / denominator));
    return Result.ok(canonicalFrame(origin, normal));
}

export function curvePointPlane(
    point: XYZ,
    tangent: XYZ,
    capturedTangent: XYZLike | undefined,
    flip: boolean | undefined,
): Result<Plane> {
    let normal = tangent.normalize();
    if (normal === undefined) return Result.err("Curve tangent is degenerate");
    if (capturedTangent !== undefined && normal.dot(new XYZ(capturedTangent)) < 0) {
        normal = normal.reverse();
    }
    const plane = planeAtPoint(point, normal);
    return plane.isOk ? Result.ok(applyFlip(plane.value, flip)) : plane;
}

// ---------------------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------------------

interface ResolvedSourceShape {
    /** The source node's own shape; every stored point/edge ref lives in this frame. */
    readonly local: IShape;
    /** The source node's world placement, applied only after a ref has been matched. */
    readonly transform: Matrix4;
    readonly edgeIds?: readonly (string | undefined)[];
}

/**
 * The world-space shape of `nodeId`, read at `anchor` when the node is a parametric body.
 * A transformed copy is owned by the caller and disposed after use.
 */
function resolveSourceShape(
    document: IDocument,
    nodeId: string,
    anchors: PlaneDefinitionBase["anchors"],
    label: string,
): Result<ResolvedSourceShape> {
    try {
        const source = resolveTimelineSource(document, nodeId, anchors?.[nodeId]);
        if (source === ROLLED_BACK_SOURCE) return Result.err(`${label} source is rolled back`);
        if (source === SOURCE_UNAVAILABLE) return Result.err(`${label} source not found`);
        const base = shapeSourceOf(document, source.node, source.shape);
        return Result.ok({
            local: base.shape,
            transform: base.transform,
            edgeIds: edgeIdsOf(source),
        });
    } catch (error) {
        return Result.err(`${label} source could not be read: ${String(error)}`);
    }
}

function edgeIdsOf(source: TimelineSource): readonly (string | undefined)[] | undefined {
    if (source.standIn) return source.edgeIds;
    const tracking = source.node as unknown as { edgeIdAt?: (index: number) => string | undefined };
    if (tracking.edgeIdAt === undefined) return undefined;
    const edgeIdAt = tracking.edgeIdAt.bind(tracking);
    const edges = source.shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges.map((_, index) => edgeIdAt(index));
}

function resolvePoint(
    document: IDocument,
    ref: PointRef,
    anchors: PlaneDefinitionBase["anchors"],
    label: string,
): Result<XYZ> {
    const source = resolveSourceShape(document, ref.nodeId, anchors, label);
    if (!source.isOk) return Result.err(source.error);
    try {
        // Topology first: an incident edge's tracked id names the vertex across upstream
        // parameter edits. The positional match is the fallback for an edge-less vertex
        // (or a lost edge) and for documents saved before the incidence was captured.
        const anchored = resolveIncidentPoint(source.value, ref.incident);
        if (anchored !== undefined) return Result.ok(source.value.transform.ofPoint(anchored));
        const vertex = matchVertex(source.value.local, ref.vertex);
        return vertex === undefined
            ? Result.err(`${label} point not found after rebuild`)
            : Result.ok(source.value.transform.ofPoint(vertex.point()));
    } catch (error) {
        return Result.err(`${label} point could not be read: ${String(error)}`);
    }
}

function withEdge<T>(
    document: IDocument,
    ref: EdgeSourceRef,
    anchors: PlaneDefinitionBase["anchors"],
    label: string,
    use: (edge: IEdge, transform: Matrix4) => Result<T>,
): Result<T> {
    const source = resolveSourceShape(document, ref.nodeId, anchors, label);
    if (!source.isOk) return Result.err(source.error);
    try {
        // The ref lives in the source's LOCAL frame, so a moved source still matches by
        // id/fingerprint; only the matched edge is carried into world coordinates.
        const indexes = matchEdgeIndexesIn(source.value.local, source.value.edgeIds, ref);
        if (!indexes.isOk) return Result.err(`${label} edge not found after rebuild`);
        const edges = source.value.local.findSubShapes(ShapeTypes.edge) as IEdge[];
        const worldEdge = worldEdgeOf(edges[indexes.value[0]], source.value.transform);
        try {
            return use(worldEdge, source.value.transform);
        } catch (error) {
            return Result.err(`${label} edge could not be read: ${String(error)}`);
        } finally {
            if (worldEdge !== edges[indexes.value[0]]) worldEdge.dispose();
        }
    } catch (error) {
        return Result.err(`${label} edge could not be read: ${String(error)}`);
    }
}

/** The source's edge in world coordinates (itself when the source sits at identity). */
function worldEdgeOf(edge: IEdge, transform: Matrix4): IEdge {
    return transform.equals(Matrix4.identity()) ? edge : (edge.transformedMul(transform) as IEdge);
}

/**
 * A curve ref may have been split into several pieces sharing one tracked id. The caller
 * that needs a point on the curve (curve-point) must search ALL of them; taking the first
 * would measure against a piece the picked point is not on.
 */
function withNearestCurve<T>(
    document: IDocument,
    ref: EdgeSourceRef,
    anchors: PlaneDefinitionBase["anchors"],
    point: XYZ,
    label: string,
    use: (edge: IEdge) => Result<T>,
): Result<T> {
    const source = resolveSourceShape(document, ref.nodeId, anchors, label);
    if (!source.isOk) return Result.err(source.error);
    const owned: IEdge[] = [];
    try {
        const indexes = matchEdgeIndexesIn(source.value.local, source.value.edgeIds, ref);
        if (!indexes.isOk) return Result.err(`${label} curve not found after rebuild`);
        const edges = source.value.local.findSubShapes(ShapeTypes.edge) as IEdge[];
        let nearest: { edge: IEdge; distance: number } | undefined;
        for (const index of indexes.value) {
            const edge = worldEdgeOf(edges[index], source.value.transform);
            if (edge !== edges[index]) owned.push(edge);
            const candidate = edge.curve.nearestFromPoint(point);
            if (nearest === undefined || candidate.distance < nearest.distance) {
                nearest = { edge, distance: candidate.distance };
            }
        }
        if (nearest === undefined) return Result.err(`${label} curve not found after rebuild`);
        return use(nearest.edge);
    } catch (error) {
        return Result.err(`${label} curve could not be read: ${String(error)}`);
    } finally {
        for (const edge of owned) edge.dispose();
    }
}

/** Edge matching inside one shape: tracked ids first, the geometric fingerprint second. */
function matchEdgeIndexesIn(
    shape: IShape,
    edgeIds: readonly (string | undefined)[] | undefined,
    ref: EdgeSourceRef,
): Result<number[]> {
    if (edgeIds !== undefined) {
        const anchored = matchEdgesAnchored(shape, [ref.edge], edgeIds);
        if (anchored.isOk) return Result.ok(anchored.value.indexes);
    }
    const matched = matchEdgeIndexes(shape, [ref.edge]);
    return matched.isOk ? Result.ok(matched.value) : Result.err(matched.error);
}

/**
 * The vertex named by an incident edge. The stored endpoints decide which physical end
 * is the vertex even when a rebuild flipped the edge's parameterization; a split edge's
 * pieces are searched for the endpoint nearest the captured one.
 */
function resolveIncidentPoint(
    source: ResolvedSourceShape,
    incident: readonly VertexAnchor[] | undefined,
): XYZ | undefined {
    if (incident === undefined) return undefined;
    const edges = source.local.findSubShapes(ShapeTypes.edge) as IEdge[];
    for (const anchor of incident) {
        const indexes = matchEdgeIndexesIn(source.local, source.edgeIds, { nodeId: "", edge: anchor.edge });
        if (!indexes.isOk || indexes.value.length === 0) continue;
        if (indexes.value.length === 1) {
            return endpointNear(edges[indexes.value[0]], anchor);
        }
        const captured = anchor.ends[anchor.end];
        let best: XYZ | undefined;
        let bestDistance = Infinity;
        for (const index of indexes.value) {
            for (const point of [edges[index].startPoint(), edges[index].endPoint()]) {
                const candidate = distance(point, captured);
                if (candidate < bestDistance) {
                    best = point;
                    bestDistance = candidate;
                }
            }
        }
        if (best !== undefined) return best;
    }
    return undefined;
}

function endpointNear(edge: IEdge, anchor: VertexAnchor): XYZ {
    const start = edge.startPoint();
    const end = edge.endPoint();
    const [capturedStart, capturedEnd] = anchor.ends;
    const direct = distance(start, capturedStart) + distance(end, capturedEnd);
    const flipped = distance(start, capturedEnd) + distance(end, capturedStart);
    const chosen = direct <= flipped ? anchor.end : anchor.end === 0 ? 1 : 0;
    return chosen === 0 ? start : end;
}

function isLineEdge(edge: IEdge): boolean {
    return CurveUtils.isLine(edge.curve.basisCurve);
}

/** Axis direction of a straight edge or the axis of a circular edge. */
function axisOfEdge(edge: IEdge): Result<XYZ> {
    const basis = edge.curve.basisCurve;
    if (CurveUtils.isCircle(basis)) return Result.ok(basis.axis);
    if (CurveUtils.isLine(basis)) return Result.ok(edge.endPoint().sub(edge.startPoint()));
    return Result.err("Point normal requires a straight or circular edge");
}
