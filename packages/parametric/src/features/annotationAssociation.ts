// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CircleEdgeAssociation,
    CurveUtils,
    type EdgeAnchor,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type IVertex,
    isAttachedAnchor,
    type Matrix4,
    type PointAnchor,
    Precision,
    type ResolvedCircleEdge,
    type ResolvedLine,
    Result,
    ShapeNode,
    ShapeTypes,
    setAnnotationAssociationResolver,
    type VisualShapeData,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { isBodyTrackingNode } from "./bodyTracking";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "./edgeRef";
import { captureProfileRef, type ProfileRef } from "./profileRef";
import { MATCH_TOLERANCE, plainVec } from "./refGeometry";
import { matchSourceFaceIndexes } from "./sourceFaceMatcher";
import { captureVertexRef, matchVertex, type VertexRef } from "./vertexRef";

/** How far off a face's surface a picked point may sit when its `(u, v)` is captured. */
const FACE_PARAMETER_TOLERANCE = 1e-3;

/**
 * Annotations bound to a node's sub-shapes: radial/diameter dimensions to a circular
 * edge, linear distances and reference segments to picked points, angular dimensions
 * to two straight edges, and text leaders to one picked point.
 *
 * The capture half turns a pick into a resolver-owned reference — an `EdgeRef`, a
 * `ProfileRef` or a `VertexRef`, local to the source node, with the tracked id when the
 * body has one — plus the world-space placement the annotation needs. The resolve half
 * re-finds that geometry on the rebuilt shape (tracked id first, then fingerprint) and
 * reports it in world space. The annotation itself owns the point math (core).
 *
 * The source may be any `ShapeNode` that rebuilds: a parametric body carries stable
 * sub-shape ids, while app primitives (`CylinderNode` etc.) rebuild without them and
 * are matched by fingerprint. A component instance is not a body of its own — `picked`
 * reports the `ComponentNode`, which has no shape — so it is deliberately unbound.
 */
export function installAnnotationAssociations(): void {
    setAnnotationAssociationResolver({
        captureCircleEdge,
        capturePointAnchor,
        captureEdgeAnchor,
        resolveCircleEdge,
        resolvePointAnchor,
        resolveEdgeAnchor,
    });
}

function captureCircleEdge(picked: VisualShapeData, textPoint: XYZ): CircleEdgeAssociation | undefined {
    const anchor = captureEdgeAnchor(picked);
    if (anchor === undefined) return undefined;

    const worldEdge = picked.shape.transformedMul(picked.transform) as IEdge;
    try {
        const basis = worldEdge.curve.basisCurve;
        if (!CurveUtils.isCircle(basis)) return undefined;

        const axis = basis.axis.normalize();
        const leader = textPoint.sub(basis.center).normalize();
        const distance = textPoint.distanceTo(basis.center);
        if (axis === undefined || leader === undefined || distance <= Precision.Distance) return undefined;

        return {
            kind: "circleEdge",
            nodeId: anchor.nodeId,
            edge: anchor.ref,
            axis: plainVec(axis),
            leader: plainVec(leader),
            distance,
        };
    } finally {
        worldEdge.dispose();
    }
}

function captureEdgeAnchor(picked: VisualShapeData | undefined): EdgeAnchor | undefined {
    const node = picked?.owner?.node;
    if (!picked || !(node instanceof ShapeNode) || !node.shape.isOk) return undefined;

    const edgeId = trackedEdgeId(node, picked.indexes[0]);
    try {
        return {
            nodeId: node.id,
            ref: captureEdgeRef(picked.shape as IEdge, edgeId, sharedEdge(node, edgeId)),
        };
    } catch {
        // A degenerate edge has no fingerprint to re-find.
        return undefined;
    }
}

/**
 * One picked point, anchored to the sub-shape the snap landed on. A pick that is not on
 * any body (typed input, the workplane) is a free anchor: it stays where it is.
 *
 * An edge endpoint is stored as a normalized parameter rather than a vertex reference,
 * because edges carry tracked ids and survive a rebuild; a bare vertex has no id and can
 * only be re-found geometrically. A snapped vertex is therefore converted to the
 * endpoint of an edge that meets it whenever one exists — vertex snaps are on by
 * default, and anchoring them geometrically would drop the reference on the first
 * parameter edit.
 */
function capturePointAnchor(picked: VisualShapeData | undefined, worldPoint: XYZ): PointAnchor {
    const free: PointAnchor = { point: plainVec(worldPoint) };
    const node = picked?.owner?.node;
    if (!picked || !(node instanceof ShapeNode) || !node.shape.isOk) return free;

    const local = picked.transform.invert()?.ofPoint(worldPoint);
    if (local === undefined) return free;

    try {
        switch (picked.shape.shapeType) {
            case ShapeTypes.vertex: {
                const endpoint = edgeEndpointAt(node, picked.shape as IVertex);
                if (endpoint !== undefined) {
                    const edgeId = trackedEdgeId(node, endpoint.index);
                    return {
                        nodeId: node.id,
                        ref: captureEdgeRef(endpoint.edge, edgeId, sharedEdge(node, edgeId)),
                        on: {
                            kind: "edge",
                            t: endpoint.t,
                            ...edgeEnds(endpoint.edge),
                        },
                        point: plainVec(worldPoint),
                    };
                }
                return {
                    nodeId: node.id,
                    ref: captureVertexRef(picked.shape as IVertex),
                    point: plainVec(worldPoint),
                };
            }
            case ShapeTypes.edge: {
                const edge = picked.shape as IEdge;
                const t = normalizedParameter(edge, local);
                if (t === undefined) return free;
                const edgeId = trackedEdgeId(node, picked.indexes[0]);
                return {
                    nodeId: node.id,
                    ref: captureEdgeRef(edge, edgeId, sharedEdge(node, edgeId)),
                    on: { kind: "edge", t, ...edgeEnds(edge) },
                    point: plainVec(worldPoint),
                };
            }
            case ShapeTypes.face: {
                const face = picked.shape as IFace;
                const uv = face.surface().parameter(local, FACE_PARAMETER_TOLERANCE);
                if (uv === undefined) return free;
                const faceId = trackedFaceId(node, picked.indexes[0]);
                return {
                    nodeId: node.id,
                    ref: captureProfileRef(face, faceId, sharedFace(node, faceId)),
                    on: { kind: "face", u: uv.u, v: uv.v },
                    point: plainVec(worldPoint),
                };
            }
            default:
                return free;
        }
    } catch {
        // A degenerate sub-shape cannot be anchored; the point stays free.
        return free;
    }
}

function resolveCircleEdge(
    document: IDocument,
    association: CircleEdgeAssociation,
): Result<ResolvedCircleEdge> {
    try {
        const node = shapeNode(document, association.nodeId);
        if (!node) return Result.err("The annotated body is missing");

        const shape = node.shape.value;
        const indexes = matchEdge(shape, node, association.edge as EdgeRef);
        if (!indexes.isOk) return Result.err(indexes.error);

        const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
        for (const index of indexes.value) {
            const circle = worldCircle(node, edges[index]);
            if (circle !== undefined) return Result.ok(circle);
        }
        return Result.err("The annotated edge is no longer a circle");
    } catch {
        // A hand-edited or foreign ref payload must fail the resolve, not the rebuild.
        return Result.err("The annotated edge could not be resolved");
    }
}

function resolvePointAnchor(document: IDocument, anchor: PointAnchor): Result<XYZ> {
    if (!isAttachedAnchor(anchor)) return Result.ok(new XYZ(anchor.point));

    try {
        const node = shapeNode(document, anchor.nodeId);
        if (!node) return Result.err("The annotated body is missing");

        const shape = node.shape.value;
        const local = localAnchorPoint(node, shape, anchor);
        if (local === undefined) return Result.err("The annotated point is missing");
        return Result.ok(node.worldTransform().ofPoint(local));
    } catch {
        return Result.err("The annotated point could not be resolved");
    }
}

function resolveEdgeAnchor(document: IDocument, anchor: EdgeAnchor): Result<ResolvedLine> {
    try {
        const node = shapeNode(document, anchor.nodeId);
        if (!node) return Result.err("The annotated body is missing");

        const shape = node.shape.value;
        const indexes = matchEdge(shape, node, anchor.ref as EdgeRef);
        if (!indexes.isOk) return Result.err(indexes.error);

        const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
        for (const index of indexes.value) {
            const edge = edges[index];
            if (edge === undefined) continue;
            const world = node.worldTransform();
            return Result.ok({
                start: world.ofPoint(edge.startPoint()),
                end: world.ofPoint(edge.endPoint()),
            });
        }
        return Result.err("The annotated edge is missing");
    } catch {
        return Result.err("The annotated edge could not be resolved");
    }
}

function shapeNode(document: IDocument, nodeId: string | undefined): ShapeNode | undefined {
    if (nodeId === undefined) return undefined;
    const node = document.modelManager.findNode((candidate) => candidate.id === nodeId);
    return node instanceof ShapeNode && node.shape.isOk ? node : undefined;
}

/**
 * The point an anchor names on the current shape, in the node's local space.
 *
 * The anchor's stored world point only breaks ties between the pieces a tracked id
 * adopted (a split edge/face): the piece whose point is nearest is the one the user
 * picked. It is never used as a silent fallback — a missing sub-shape must warn.
 */
function localAnchorPoint(node: ShapeNode, shape: IShape, anchor: PointAnchor): XYZ | undefined {
    const world = node.worldTransform();
    const on = anchor.on;

    if (on?.kind === "edge") {
        const indexes = matchEdge(shape, node, anchor.ref as EdgeRef);
        if (!indexes.isOk) return undefined;
        const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
        return nearestCandidate(
            indexes.value.flatMap((index) => {
                const edge = edges[index];
                if (edge === undefined) return [];
                const first = edge.firstParameter();
                const span = edge.lastParameter() - first;
                return edgeParameters(edge, on).map((t) => ({
                    local: edge.pointAt(first + span * t),
                    world,
                }));
            }),
            anchor.point,
        );
    }

    if (on?.kind === "face") {
        const indexes = matchFace(shape, node, anchor.ref as ProfileRef);
        if (!indexes.isOk) return undefined;
        const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
        return nearestCandidate(
            indexes.value.flatMap((index) => {
                const face = faces[index];
                if (face === undefined) return [];
                // The surface parameterization survives a rebuild; a point that fell
                // outside the re-trimmed face has no place to go.
                const local = face.surface().value(on.u, on.v);
                return face.containsPoint(local, true, FACE_PARAMETER_TOLERANCE) ? [{ local, world }] : [];
            }),
            anchor.point,
        );
    }

    const vertex = matchVertex(shape, anchor.ref as VertexRef);
    return vertex?.point();
}

function nearestCandidate(candidates: { local: XYZ; world: Matrix4 }[], picked: XYZLike): XYZ | undefined {
    let best: XYZ | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const distance = candidate.world.ofPoint(candidate.local).distanceTo(picked);
        if (distance < bestDistance) {
            best = candidate.local;
            bestDistance = distance;
        }
    }
    return best;
}

/** The matched edge indexes, through the tracked ids when the node has them. */
function matchEdge(shape: IShape, node: ShapeNode, ref: EdgeRef): Result<number[]> {
    if (!isBodyTrackingNode(node) || !node.hasTrackedIds("edge")) {
        return matchEdgeIndexes(shape, [ref]);
    }

    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const matched = matchEdgesAnchored(
        shape,
        [ref],
        edges.map((_, index) => node.edgeIdAt(index)),
    );
    return matched.isOk ? Result.ok(matched.value.indexes) : Result.err(matched.error);
}

/** The matched face indexes, through tracked ids when available, else by fingerprint. */
function matchFace(shape: IShape, node: ShapeNode, ref: ProfileRef): Result<number[]> {
    const faces = shape.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds =
        isBodyTrackingNode(node) && node.hasTrackedIds("face")
            ? faces.map((_, index) => node.faceIdAt(index))
            : undefined;
    const matched = matchSourceFaceIndexes(faces, faceIds, [ref]);
    return matched.isOk ? Result.ok(matched.value.indexes) : Result.err(matched.error);
}

/** A rebuilt edge as a world-space circle, or undefined when it is gone or no longer one. */
function worldCircle(node: ShapeNode, edge: IEdge | undefined): ResolvedCircleEdge | undefined {
    if (edge === undefined) return undefined;
    try {
        const basis = edge.curve.basisCurve;
        if (!CurveUtils.isCircle(basis)) return undefined;

        const world = node.worldTransform();
        const center = world.ofPoint(basis.center);
        // The world radius is measured on a real point of the circle rather than
        // scaling the scalar, so a scaled instance transform stays correct.
        const radius = world.ofPoint(edge.startPoint()).distanceTo(center);
        const axis = world.ofVector(basis.axis).normalize();
        if (axis === undefined || radius <= Precision.Distance) return undefined;
        return { center, radius, axis };
    } catch {
        // A degenerate edge reports its curve through a throw.
        return undefined;
    }
}

function normalizedParameter(edge: IEdge, local: XYZ): number | undefined {
    const parameter = edge.curve.nearestFromPoint(local).parameter;
    const first = edge.firstParameter();
    const span = edge.lastParameter() - first;
    if (Math.abs(span) < Precision.Distance) return undefined;
    return (parameter - first) / span;
}

/**
 * The parameter(s) to try for an edge anchor on the rebuilt edge.
 *
 * The matcher accepts a reversed fingerprint (a rebuilt edge may carry the same
 * geometry with the opposite parameterization), which turns `t` into its complement.
 * When the captured endpoints tell the orientation apart — `same`/`reversed` compare
 * the resolved edge's ends with the captured ones — exactly one parameter is returned.
 * A closed edge (both endpoints coincide) says nothing about direction, so both are
 * offered and the stored world point picks the nearer one.
 */
function edgeParameters(
    edge: IEdge,
    on: { readonly t: number; readonly start?: XYZLike; readonly end?: XYZLike },
): number[] {
    if (on.start === undefined || on.end === undefined) return [on.t, 1 - on.t];

    const start = edge.startPoint();
    const end = edge.endPoint();
    const same = start.distanceTo(on.start) + end.distanceTo(on.end);
    const reversed = start.distanceTo(on.end) + end.distanceTo(on.start);
    if (Math.abs(same - reversed) <= MATCH_TOLERANCE) return [on.t, 1 - on.t];
    return [reversed < same ? 1 - on.t : on.t];
}

/** The picked edge's local endpoints, for the direction check on the rebuilt edge. */
function edgeEnds(edge: IEdge): { start: XYZLike; end: XYZLike } {
    return { start: plainVec(edge.startPoint()), end: plainVec(edge.endPoint()) };
}

/**
 * An edge of the node's current shape that ends at `vertex`. The endpoint parameter is
 * the anchor's `t`; `index` is the edge's position in `findSubShapes`, which is what the
 * tracked-id lookup expects.
 */
function edgeEndpointAt(
    node: ShapeNode,
    vertex: IVertex,
): { edge: IEdge; index: number; t: number } | undefined {
    const point = vertex.point();
    const edges = node.shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];
    for (const [index, edge] of edges.entries()) {
        try {
            if (edge.startPoint().distanceTo(point) <= MATCH_TOLERANCE) return { edge, index, t: 0 };
            if (edge.endPoint().distanceTo(point) <= MATCH_TOLERANCE) return { edge, index, t: 1 };
        } catch {
            // A degenerate edge has no endpoints to compare.
        }
    }
    return undefined;
}

function trackedEdgeId(node: ShapeNode, index: number | undefined): string | undefined {
    if (index === undefined || !isBodyTrackingNode(node) || !node.hasTrackedIds("edge")) return undefined;
    return node.edgeIdAt(index);
}

function trackedFaceId(node: ShapeNode, index: number | undefined): string | undefined {
    if (index === undefined || !isBodyTrackingNode(node) || !node.hasTrackedIds("face")) return undefined;
    return node.faceIdAt(index);
}

function sharedEdge(node: ShapeNode, id: string | undefined): boolean {
    return id !== undefined && isBodyTrackingNode(node) && node.edgeIndexesOfId(id).length > 1;
}

function sharedFace(node: ShapeNode, id: string | undefined): boolean {
    return id !== undefined && isBodyTrackingNode(node) && node.faceIndexesOfId(id).length > 1;
}
