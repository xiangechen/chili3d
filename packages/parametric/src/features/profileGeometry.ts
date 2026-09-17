// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CurveUtils,
    type IEdge,
    type IShape,
    type Plane,
    Precision,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import { INCIDENCE_TOLERANCE } from "./refGeometry";

/**
 * Planar primitives the profile builder reasons with — no knowledge of profiles,
 * sketches or refs. Two groups:
 *
 * - **Loop sampling and containment** (`sampleLoop`, `loopContains`, `pointInPolygon`),
 *   which is how even-odd nesting is decided.
 * - **Edge relationship predicates** (`needsKernelSplit`, `groupConnected`,
 *   `hasBranchVertex`, …), which is how a bag of sketch edges is decided to be simple
 *   loops or to need the kernel's splitter.
 *
 * Kept apart from `profileBuilder.ts` so the profile logic there reads as profile logic.
 */

/**
 * Samples per edge when approximating a loop as a polygon for the containment test.
 * A loop's chord polygon is inscribed in its curves, so the sampled region is a strict
 * subset of the true loop — a hole close to an outer boundary can then test as
 * "outside". The inscribed error shrinks quadratically with the sample count (a
 * circle's sagitta is r·(1 − cos(π/n))); 64 keeps it under ~0.1% of the radius, well
 * inside sketch tolerance.
 */
const LOOP_SAMPLES = 64;

/** A loop approximated as a 2D polygon in sketch-plane coordinates. */
export type Polygon = [number, number][];

/**
 * Approximates a loop as a 2D polygon in sketch-plane coordinates. The edges are
 * walked in chain order — each edge starts where the previous one ended — so the
 * sampled points trace the loop boundary. Sampling the raw group order instead would
 * jump between non-adjacent edges and corrupt the containment test with spurious chords.
 */
export function sampleLoop(edges: IEdge[], plane: Plane): Polygon {
    const points: Polygon = [];
    if (edges.length === 0) return points;

    const remaining = edges.slice();
    let edge = remaining.shift()!;
    appendEdgeSamples(edge, edge.startPoint(), points, plane);
    let head = edge.endPoint();

    while (remaining.length > 0) {
        const index = remaining.findIndex(
            (candidate) => coincides(head, candidate.startPoint()) || coincides(head, candidate.endPoint()),
        );
        if (index === -1) break;
        edge = remaining.splice(index, 1)[0];
        const next = coincides(head, edge.startPoint()) ? edge.endPoint() : edge.startPoint();
        appendEdgeSamples(edge, head, points, plane);
        head = next;
    }
    return points;
}

/** Samples `edge` starting from its `from` endpoint, in sketch-plane coordinates. */
function appendEdgeSamples(edge: IEdge, from: XYZ, points: Polygon, plane: Plane): void {
    const reversed = !coincides(from, edge.startPoint());
    const start = reversed ? edge.lastParameter() : edge.firstParameter();
    const end = reversed ? edge.firstParameter() : edge.lastParameter();
    // A line is its own chord — its two endpoints trace it exactly — so it needs no
    // dense sampling. Only curved edges pay the LOOP_SAMPLES cost to bound the inscribed
    // error; line-heavy sketches (the common case) stay cheap. When `curve` is absent
    // (some test mocks), fall back to the dense sampling.
    const basis = edge.curve?.basisCurve;
    const samples = basis !== undefined && CurveUtils.isLine(basis) ? 2 : LOOP_SAMPLES;
    // Sample [start, end] inclusive so chained edges share their endpoints; a curve's
    // final sample coincides with the next edge's start (harmless to pointInPolygon).
    const step = (end - start) / (samples - 1);
    for (let i = 0; i < samples; i++) {
        const point = edge.pointAt(start + step * i);
        const vec = point.sub(plane.origin);
        points.push([vec.dot(plane.xvec), vec.dot(plane.yvec)]);
    }
}

/**
 * True when the inner loop is fully enclosed by the outer polygon. The connectivity
 * path only sees non-crossing loops — disjoint or properly nested — so a loop is a
 * hole of another only when every sampled point lies inside it. A bare majority would
 * misread a partially-overlapping loop (an overlap near 50%) as a nesting.
 */
export function loopContains(outer: Polygon, inner: Polygon): boolean {
    return inner.every((point) => pointInPolygon(point, outer));
}

function pointInPolygon([x, y]: [number, number], polygon: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

export function collectEdges(shape: IShape): IEdge[] {
    if (shape.shapeType === ShapeTypes.edge) return [shape as IEdge];
    return shape.findSubShapes(ShapeTypes.edge) as IEdge[];
}

/**
 * True when the sketch needs the kernel's edge-splitting path: any contact that is
 * not a plain vertex contact (both edges meeting at a shared endpoint) means an edge
 * is split at the contact — either two edges crossing mid-span, or one edge's
 * endpoint landing on the interior of another (a T-junction, e.g. a divider line
 * whose ends sit on a rectangle's edges). Vertex contacts need no splitting and stay
 * on the connectivity path.
 *
 * Two contact shapes hide from `IEdge.intersect`: the kernel reports nothing for
 * parallel curves, so a collinear overlapping edge goes unseen, and a solver residual
 * can leave an endpoint a hair off the edge it is constrained onto. Both still split
 * the touched edge, so the endpoints are probed against the other edge directly; the
 * kernel's fuzzy splitter absorbs gaps of `Precision.Distance` scale.
 */
export function needsKernelSplit(edges: IEdge[]): boolean {
    // Endpoint getters are kernel queries — cache them for the whole O(n²) pass.
    const points = edges.map((edge) => endpoints(edge));
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            // Bounding boxes that do not touch cannot intersect; skip the kernel call.
            if (!BoundingBox.isIntersect(edges[i].boundingBox(), edges[j].boundingBox())) continue;
            if (
                edges[i]
                    .intersect(edges[j])
                    .some(({ point }) => !isVertexContact(points[i], points[j], point))
            ) {
                return true;
            }
            if (endpointOnInterior(points[i], edges[j], points[j])) return true;
            if (endpointOnInterior(points[j], edges[i], points[i])) return true;
        }
    }
    return false;
}

/**
 * True when an endpoint of one edge lies on `b`'s interior (a T-junction). Endpoints
 * near `b`'s own endpoints are plain vertex contacts and need no split. The probe
 * tolerance is INCIDENCE_TOLERANCE — the probe exists to catch solver residuals of
 * that scale. The endpoint distances settle the near cases without a curve query:
 * within INCIDENCE_TOLERANCE of one of `b`'s ends the endpoint is on `b`'s curve by
 * triangle inequality; only endpoints farther from both ends can land mid-span, and
 * only those pay the query.
 */
function endpointOnInterior(aPoints: [XYZ, XYZ], b: IEdge, bPoints: [XYZ, XYZ]): boolean {
    return aPoints.some((point) => {
        const toStart = point.distanceTo(bPoints[0]);
        const toEnd = point.distanceTo(bPoints[1]);
        if (toStart < Precision.Distance || toEnd < Precision.Distance) return false;
        if (toStart < INCIDENCE_TOLERANCE || toEnd < INCIDENCE_TOLERANCE) return true;
        return b.curve.nearestFromPoint(point).distance < INCIDENCE_TOLERANCE;
    });
}

/** A contact at a shared endpoint of both edges is a plain vertex; anything else splits an edge. */
function isVertexContact(aPoints: [XYZ, XYZ], bPoints: [XYZ, XYZ], point: XYZ): boolean {
    return nearEndpoint(aPoints, point) && nearEndpoint(bPoints, point);
}

function nearEndpoint(edgePoints: [XYZ, XYZ], point: XYZ): boolean {
    return (
        point.distanceTo(edgePoints[0]) < Precision.Distance ||
        point.distanceTo(edgePoints[1]) < Precision.Distance
    );
}

export function groupConnected(edges: IEdge[]): IEdge[][] {
    const remaining = [...edges];
    const groups: IEdge[][] = [];
    while (remaining.length > 0) {
        // Seed each group from the first remaining edge — the lowest entity — so groups
        // come out in entity order. That order is stable under append: a newly added
        // entity carries a higher id and lands in a group after the existing ones, so
        // existing profiles keep their positional index — the fallback seed when
        // entity ids are unavailable, and the occurrence order behind the `~n`
        // suffix telling apart profiles bounded by the same entity set.
        const group = [remaining.shift()!];
        let grew = true;
        while (grew) {
            grew = false;
            for (let i = remaining.length - 1; i >= 0; i--) {
                if (touches(group, remaining[i])) {
                    group.push(remaining.splice(i, 1)[0]);
                    grew = true;
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

/**
 * True when three or more edge endpoints meet at one point. A connected group whose
 * vertices all have degree 2 is a single simple loop (degree 1 is a dangling open end);
 * a higher degree means the group folds into a figure-eight or T-junction that cannot
 * be chained into one wire, so `sketchProfiles` routes it through the kernel.
 */
export function hasBranchVertex(group: IEdge[]): boolean {
    const endpoints = group.flatMap((edge) => [edge.startPoint(), edge.endPoint()]);
    for (let i = 0; i < endpoints.length; i++) {
        let count = 0;
        for (let j = 0; j < endpoints.length; j++) {
            if (coincides(endpoints[i], endpoints[j])) count++;
        }
        if (count > 2) return true;
    }
    return false;
}

function touches(group: IEdge[], edge: IEdge): boolean {
    return group.some((x) => endpoints(x).some((a) => endpoints(edge).some((b) => coincides(a, b))));
}

function endpoints(edge: IEdge): [XYZ, XYZ] {
    return [edge.startPoint(), edge.endPoint()];
}

function coincides(a: ReturnType<IEdge["startPoint"]>, b: ReturnType<IEdge["startPoint"]>): boolean {
    return a.distanceTo(b) < Precision.Distance;
}
