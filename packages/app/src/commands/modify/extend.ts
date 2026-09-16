// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    command,
    EditableShapeNode,
    type ICircle,
    type ICurve,
    type IEdge,
    type ILine,
    type IShape,
    type IShapeFilter,
    type ISubEdgeShape,
    type ITrimmedCurve,
    MultistepCommand,
    Precision,
    PubSub,
    property,
    Result,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    type XYZ,
} from "@chili3d/core";
import { replaceShapeNode } from "./edgeCornerCommand";

/** The parameters of the point where two support curves meet, one per curve. */
interface Corner {
    p1: number;
    p2: number;
}

/**
 * The support curve of an edge: the unwrapped basis curve (a line or a
 * circle) and the edge's parameter range on it. `period` is 2π for a circle
 * and 0 for an (unbounded) line.
 */
interface SupportCurve {
    curve: ICurve;
    first: number;
    last: number;
    period: number;
    /** The point at a parameter of the basis curve. */
    value(u: number): XYZ;
}

function getBasisCurve(curve: ICurve) {
    let basisCurve = curve;
    while ((basisCurve as ITrimmedCurve).basisCurve) {
        basisCurve = (basisCurve as ITrimmedCurve).basisCurve;
    }
    return basisCurve;
}

/** The support curve of an edge; undefined when the edge is neither straight nor an arc. */
function supportCurve(edge: IEdge): SupportCurve | undefined {
    const curve = edge.curve;
    const basis = getBasisCurve(curve);
    const range = {
        first: curve.firstParameter(),
        last: curve.lastParameter(),
        value: (u: number) => curve.value(u),
    };
    if (CurveUtils.isLine(basis)) return { curve: basis, ...range, period: 0 };
    if (CurveUtils.isCircle(basis)) return { curve: basis, ...range, period: 2 * Math.PI };
    return undefined;
}

/**
 * The corner of two support lines, solved like the 2D corner of the
 * fillet/chamfer operations (see computeCornerPlane in cpp/src/factory.cpp):
 * the intersection of the support lines, which need not lie on the edges
 * themselves.
 */
function lineIntersection(s1: SupportCurve, s2: SupportCurve): Result<Corner> {
    if (!CurveUtils.isLine(s1.curve) || !CurveUtils.isLine(s2.curve)) {
        return Result.err("Edges must be straight lines or arcs");
    }

    const d1 = s1.curve.direction.normalize()!;
    const d2 = s2.curve.direction.normalize()!;
    const normal = d1.cross(d2);
    const denom = normal.dot(normal);
    if (denom < Precision.Float) {
        return Result.err("Edges must not be parallel");
    }

    const p12 = s2.value(s2.first).sub(s1.value(s1.first));
    if (Math.abs(p12.dot(normal)) > Precision.Distance * Math.sqrt(denom)) {
        return Result.err("Edges must be coplanar");
    }

    return Result.ok({
        p1: s1.first + p12.cross(d2).dot(normal) / denom,
        p2: s2.first + p12.cross(d1).dot(normal) / denom,
    });
}

/** Distance of a parameter outside the edge's current range (0 when inside). */
function distanceOutside(p: number, support: SupportCurve): number {
    return p < support.first ? support.first - p : p > support.last ? p - support.last : 0;
}

/** The representative of p (modulo the period) closest to the edge's current range. */
function normalizeToRange(p: number, support: SupportCurve): number {
    if (support.period === 0) return p;

    let best = p;
    for (const k of [-1, 1]) {
        const candidate = p + k * support.period;
        if (distanceOutside(candidate, support) < distanceOutside(best, support)) best = candidate;
    }
    return best;
}

/**
 * A temporary edge spanning the full extendable range of the support curve:
 * a whole period for a circle; for a line, a span covering the other circle's
 * reach, since the intersection of a line and a circle lies within the
 * circle's projection onto the line.
 */
function maximalEdge(edge: IEdge, support: SupportCurve, other: SupportCurve): IEdge | undefined {
    if (support.period > 0) {
        return edge.trim(support.first, support.first + support.period);
    }

    // two lines are solved analytically, so `other` is always a circle here
    const line = support.curve as ILine;
    const circle = other.curve as ICircle;
    const direction = line.direction.normalize()!;
    const centerParameter = support.first + circle.center.sub(support.value(support.first)).dot(direction);
    const margin = circle.radius * 1e-3;
    return edge.trim(
        Math.min(support.first, centerParameter - circle.radius - margin),
        Math.max(support.last, centerParameter + circle.radius + margin),
    );
}

/** A candidate intersection of two support curves: the corner parameters and the point itself. */
interface IntersectionCandidate extends Corner {
    point: XYZ;
}

/**
 * Distance from an intersection point to an edge: 0 when it already lands on
 * the edge, otherwise the distance to the nearest endpoint.
 */
function endpointDistance(p: number, point: XYZ, support: SupportCurve): number {
    if (p >= support.first && p <= support.last) return 0;
    return point.distanceTo(support.value(p < support.first ? support.first : support.last));
}

/** The end of the edge nearest to the point where the user picked it. */
type PickedEnd = "first" | "last" | undefined;

function pickedEnd(support: SupportCurve, point: XYZ | undefined): PickedEnd {
    if (point === undefined) return undefined;
    const toFirst = point.distanceTo(support.value(support.first));
    return toFirst <= point.distanceTo(support.value(support.last)) ? "first" : "last";
}

/** True when extending the edge's range to p grows the end opposite to the picked one. */
function extendsAwayFromPick(p: number, support: SupportCurve, end: PickedEnd): boolean {
    if (end === undefined) return false;
    if (p < support.first) return end === "last";
    if (p > support.last) return end === "first";
    return false;
}

/**
 * The corner of two support curves of which at least one is a circle, found
 * by intersecting the maximal edges. A line and a circle or two circles can
 * meet twice; an intersection reached by extending the picked endpoints is
 * preferred, and the intersection geometrically nearest to the two edges
 * breaks the tie (the same "nearest intersection" rule AutoCAD applies).
 */
function curveIntersection(
    edge1: IEdge,
    s1: SupportCurve,
    edge2: IEdge,
    s2: SupportCurve,
    end1: PickedEnd,
    end2: PickedEnd,
): Result<Corner> {
    const temp1 = maximalEdge(edge1, s1, s2);
    const temp2 = maximalEdge(edge2, s2, s1);
    try {
        // a maximal window is never empty by construction; treat a missing
        // extent as "no intersection" rather than crashing on undefined
        if (temp1 === undefined || temp2 === undefined) {
            return Result.err("Edges do not intersect when extended");
        }
        const candidates = temp1.intersect(temp2).flatMap((x): IntersectionCandidate[] => {
            const p2 = temp2.curve.parameter(x.point, Precision.Distance);
            return p2 === undefined
                ? []
                : [{ point: x.point, p1: normalizeToRange(x.parameter, s1), p2: normalizeToRange(p2, s2) }];
        });
        if (candidates.length === 0) {
            return Result.err("Edges do not intersect when extended");
        }

        const missed = (c: IntersectionCandidate) =>
            (extendsAwayFromPick(c.p1, s1, end1) ? 1 : 0) + (extendsAwayFromPick(c.p2, s2, end2) ? 1 : 0);
        const cost = (c: IntersectionCandidate) =>
            endpointDistance(c.p1, c.point, s1) + endpointDistance(c.p2, c.point, s2);
        candidates.sort((a, b) => missed(a) - missed(b) || cost(a) - cost(b));
        return Result.ok(candidates[0]);
    } finally {
        temp1?.dispose();
        temp2?.dispose();
    }
}

/** Which ends of an edge may move: both ends of a standalone edge, only the free (unshared) ends of a wire edge. */
interface FreeEnds {
    first: boolean;
    last: boolean;
}

/** The free ends of a wire edge: an end is shared when another edge of the wire starts or ends there. */
function freeEnds(wire: IShape, edge: ISubEdgeShape): FreeEnds {
    const others = (wire.findSubShapes(ShapeTypes.edge) as IEdge[]).filter((x) => !x.isEqual(edge));
    const isShared = (point: XYZ) =>
        others.some(
            (x) =>
                x.startPoint().distanceTo(point) <= Precision.Distance ||
                x.endPoint().distanceTo(point) <= Precision.Distance,
        );
    return { first: !isShared(edge.startPoint()), last: !isShared(edge.endPoint()) };
}

/**
 * Rebuild the edge so its range reaches p. When both ends are free the picked
 * endpoint moves to p (the longer side without a pick point); when only one
 * end is free the free end moves to p and the shared end anchors the edge,
 * even when the corner lies beyond the anchor; when both ends are shared the
 * range cannot change at all. An arc may never grow to a full circle.
 */
function edgeThroughParameter(
    edge: IEdge,
    support: SupportCurve,
    p: number,
    end: PickedEnd,
    free: FreeEnds,
): Result<IEdge> {
    let [first, last] = [support.first, support.last];
    const tol = support.period > 0 ? Precision.Angle : Precision.Distance;
    if (!free.first && !free.last) {
        if (p < first - tol || p > last + tol || (p > first + tol && p < last - tol)) {
            return Result.err("The shared endpoint of a wire edge cannot move");
        }
    } else if (free.first !== free.last) {
        // only the free end moves to p; the shared end anchors the edge
        if (free.first) {
            const q = Math.abs(p - last) <= tol ? last : p;
            [first, last] = [Math.min(q, last), Math.max(q, last)];
        } else {
            const q = Math.abs(p - first) <= tol ? first : p;
            [first, last] = [Math.min(first, q), Math.max(first, q)];
        }
    } else if (p > first && p < last) {
        if (end === "first" || (end === undefined && p - first < last - p)) {
            first = p;
        } else {
            last = p;
        }
    } else {
        first = Math.min(first, p);
        last = Math.max(last, p);
    }

    if (support.period > 0 && last - first >= support.period - Precision.Angle) {
        return Result.err("Arc would become a full circle");
    }
    const trimmed = edge.trim(first, last);
    // a corner within tolerance of the anchored end leaves an empty window
    return trimmed === undefined ? Result.err("Edge would shrink to a point") : Result.ok(trimmed);
}

/**
 * Extend (or trim) the target edge until it meets the boundary edge. `point1`
 * and `point2` are the points where the user picked the edges, in the same
 * space as the edges; they decide which end of an edge is extended or kept.
 * The boundary edge is always met at the corner of the two support curves -
 * even when its own geometry does not reach the corner; `modifyBoundary`
 * only decides whether the boundary edge is also extended (or cut back)
 * along its support curve to the corner. `free1` and `free2` say which ends
 * of each edge may move: a shared endpoint of a wire edge never moves, so
 * the wire keeps its connectivity.
 */
function extendEdgeToBoundary(
    target: IEdge,
    boundary: IEdge,
    modifyBoundary: boolean,
    free1: FreeEnds,
    free2: FreeEnds,
    point1?: XYZ,
    point2?: XYZ,
): Result<[IEdge, IEdge | undefined]> {
    const s1 = supportCurve(target);
    const s2 = supportCurve(boundary);
    if (s1 === undefined || s2 === undefined) {
        return Result.err("Edges must be straight lines or arcs");
    }

    const end1 = pickedEnd(s1, point1);
    const end2 = pickedEnd(s2, point2);
    const corner =
        s1.period === 0 && s2.period === 0
            ? lineIntersection(s1, s2)
            : curveIntersection(target, s1, boundary, s2, end1, end2);
    if (!corner.isOk) return corner.parse();

    const ext1 = edgeThroughParameter(target, s1, corner.value.p1, end1, free1);
    if (!ext1.isOk) return ext1.parse();

    if (!modifyBoundary) return Result.ok([ext1.value, undefined]);

    const ext2 = edgeThroughParameter(boundary, s2, corner.value.p2, end2, free2);
    if (!ext2.isOk) {
        ext1.value.dispose();
        return ext2.parse();
    }
    return Result.ok([ext1.value, ext2.value]);
}

/**
 * Extend an edge until it meets a boundary edge. The target edge can be a
 * standalone edge body or an edge of a wire; the boundary edge - picked in a
 * second step - can be any other standalone edge or wire edge. The target
 * edge is prolonged (or cut back) along its support curve up to the
 * intersection of the two curves; the `modifyBoundary` option decides
 * whether the boundary edge is moved to the corner too. Only a free
 * endpoint of a wire edge can move - an endpoint shared with another edge
 * of the wire stays put, so the wire keeps its connectivity. The point
 * where an edge was picked decides which of its ends moves to the corner
 * when the geometry leaves a choice.
 */
@command({
    key: "modify.extend",
    icon: "icon-extend",
})
export class ExtendCommand extends MultistepCommand {
    /** Whether the boundary edge is also extended (or cut back) to the corner. */
    @property("option.command.modifyBoundary")
    get modifyBoundary() {
        return this.getPrivateValue("modifyBoundary", true);
    }
    set modifyBoundary(value: boolean) {
        this.setProperty("modifyBoundary", value);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const target = this.stepDatas[0].shapes[0];
            const boundary = this.stepDatas[1].shapes[0];

            // bake the transforms in: the edges and the pick points are all in world space
            const [edge1, edge2] = [target, boundary].map((x) => {
                const edge = x.shape.transformedMul(x.transform) as IEdge;
                this.disposeStack.add(edge);
                return edge;
            });

            const free1 = ExtendCommand.freeEndsOf(target);
            const free2 = ExtendCommand.freeEndsOf(boundary);
            const extended = extendEdgeToBoundary(
                edge1,
                edge2,
                this.modifyBoundary,
                free1,
                free2,
                target.point,
                boundary.point,
            );
            if (!extended.isOk) {
                PubSub.default.pub("displayError", extended.error);
                return;
            }

            this.replaceEdges(target, boundary, extended.value);
            this.document.visual.update();
        });
    }

    /** Which ends of the picked edge may move: a shared endpoint of a wire edge never moves. */
    private static freeEndsOf(data: VisualShapeData): FreeEnds {
        const sub = data.shape as ISubEdgeShape;
        return sub.parent.shapeType === ShapeTypes.wire
            ? freeEnds(sub.parent, sub)
            : { first: true, last: true };
    }

    /** Splice the extended edges back into the document. */
    private replaceEdges(
        target: VisualShapeData,
        boundary: VisualShapeData,
        extended: [IEdge, IEdge | undefined],
    ) {
        const targetParent = (target.shape as ISubEdgeShape).parent;
        const boundaryParent = (boundary.shape as ISubEdgeShape).parent;
        const sameWire =
            targetParent.shapeType === ShapeTypes.wire &&
            boundaryParent.shapeType === ShapeTypes.wire &&
            boundaryParent.isPartner(targetParent);

        if (sameWire) {
            // both edges live in the same wire: rebuild it once with both replacements
            const replacements: [VisualShapeData, IEdge][] = [[target, extended[0]]];
            if (extended[1] !== undefined) replacements.push([boundary, extended[1]]);
            const newWire = this.computeExtendedWire(targetParent, replacements);
            if (!newWire.isOk) {
                PubSub.default.pub("displayError", newWire.error);
                return;
            }
            replaceShapeNode(target.owner.node as ShapeNode, newWire.value);
            return;
        }

        this.replaceEdge(target, extended[0]);
        if (extended[1] !== undefined) this.replaceEdge(boundary, extended[1]);
    }

    /**
     * Replace a picked edge by its extended version, which is in world space
     * (the transform was baked in). An edge of a wire is spliced back into the
     * wire; a standalone edge node is swapped for a new one holding the world
     * geometry, so no transform is copied.
     */
    private replaceEdge(data: VisualShapeData, worldEdge: IEdge) {
        const parent = (data.shape as ISubEdgeShape).parent;
        if (parent.shapeType === ShapeTypes.wire) {
            const newWire = this.computeExtendedWire(parent, [[data, worldEdge]]);
            if (!newWire.isOk) {
                PubSub.default.pub("displayError", newWire.error);
                return;
            }
            replaceShapeNode(data.owner.node as ShapeNode, newWire.value);
            return;
        }

        const node = data.owner.node as ShapeNode;
        (node.parent ?? this.document.modelManager.rootNode).add(this.standaloneEdgeNode(node, worldEdge));
        node.parent?.remove(node);
    }

    /** Rebuild a wire with the given sub-edges replaced by their world-space extended versions. */
    private computeExtendedWire(wire: IShape, replacements: [VisualShapeData, IEdge][]): Result<IShape> {
        const edges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
        for (const [data, worldEdge] of replacements) {
            const index = edges.findIndex((x) => x.isEqual(data.shape as ISubEdgeShape));
            if (index < 0) return Result.err("The edge must belong to the wire.");

            // the wire is rebuilt in node-local space
            const inverse = data.transform.invert();
            if (inverse === undefined) return Result.err("The node transform is not invertible.");
            edges[index] = worldEdge.transformedMul(inverse) as IEdge;
        }
        return shapeFactory.wire(edges);
    }

    private standaloneEdgeNode(source: ShapeNode, shape: IEdge) {
        return new EditableShapeNode({
            document: this.document,
            name: source.name,
            shape,
            materialId: source.materialId,
        });
    }

    /** Only standalone edge bodies and wire edges can be extended. */
    private readonly _edgeFilter: IShapeFilter = {
        allow: (shape) => ExtendCommand.isExtendableEdge(shape as ISubEdgeShape),
    };

    private static isExtendableEdge(shape: ISubEdgeShape): boolean {
        return shape.parent?.shapeType === ShapeTypes.edge || shape.parent?.shapeType === ShapeTypes.wire;
    }

    /** Any standalone edge or wire edge can be the boundary, except the target edge itself. */
    private readonly _boundaryFilter: IShapeFilter = {
        allow: (shape) => this.canPickBoundary(shape as ISubEdgeShape),
    };

    private canPickBoundary(shape: ISubEdgeShape): boolean {
        if (!ExtendCommand.isExtendableEdge(shape)) return false;

        const target = this.stepDatas.at(0)?.shapes.at(0)?.shape as ISubEdgeShape | undefined;
        return target !== undefined && !shape.isEqual(target);
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.extendTarget", {
                shapeFilter: this._edgeFilter,
            }),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.boundary", {
                shapeFilter: this._boundaryFilter,
                keepSelection: true,
            }),
        ];
    }
}
