// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CurveUtils,
    type IEdge,
    type IFace,
    type IShape,
    type IWire,
    type Plane,
    Precision,
    Result,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { matchProfileIndexes, type ProfileRef, registerProfileEntities } from "./profileRef";

/**
 * Samples per edge when approximating a loop as a polygon for the containment test.
 * A loop's chord polygon is inscribed in its curves, so the sampled region is a strict
 * subset of the true loop — a hole close to an outer boundary can then test as
 * "outside". The inscribed error shrinks quadratically with the sample count (a
 * circle's sagitta is r·(1 − cos(π/n))); 64 keeps it under ~0.1% of the radius, well
 * inside sketch tolerance.
 */
const LOOP_SAMPLES = 64;

export interface SketchProfileSet {
    /**
     * Default profiles: loops at even nesting depth, each built with its direct child
     * loops as holes (`shapeFactory.face([outer, ...holes])`).
     */
    readonly outer: IFace[];
    /** Hole loops as solid faces — selectable as profiles, but not extruded by default. */
    readonly inner: IFace[];
    /**
     * Crossing path only (undefined on the connectivity path): the sorted ids of the
     * sketch entities bounding each `outer` profile — the region's primary identity
     * for `ProfileRef.entities` (geometric fingerprints cannot tell adjacent regions
     * apart, they share segments of the same entities). `undefined` entries mark the
     * connectivity-path faces of a mixed sketch (see `sketchProfiles`), which keep
     * geometric identity.
     */
    readonly outerEntities?: (number[] | undefined)[];
}

/** A loop approximated as a 2D polygon in sketch-plane coordinates. */
type Polygon = [number, number][];

/**
 * Extrudable profiles of a sketch as faces. Sketch entities are combined into a
 * compound (they may be disjoint), so edges are first grouped by endpoint
 * connectivity; the wire factory chains each group in place. Nested loops follow
 * even-odd semantics: an inner loop becomes a hole of the containing profile instead
 * of an independent face — unless explicitly selected, see `resolveProfiles`.
 *
 * When edges cross mid-span (no shared endpoints at the crossing), grouping cannot see
 * the extra regions, so the whole sketch goes through `shapeFactory.facesFromEdges`,
 * which splits the edges at their intersections and returns every minimal bounded
 * region as a profile (even-odd no longer applies on that path).
 */
export function sketchProfiles(sketch: SketchNode): Result<SketchProfileSet> {
    const shape = sketch.shape;
    if (!shape.isOk) return Result.err(shape.error);

    const edges = collectEdges(shape.value);
    if (edges.length === 0) return Result.err("Sketch has no entities");

    // Mid-span crossings and T-junctions split edges into regions endpoint connectivity
    // cannot see, so the whole sketch goes through the kernel.
    if (needsKernelSplit(edges)) {
        return crossingProfiles(
            edges,
            sketch.data.entities.map((entity) => entity.id),
            sketch,
        );
    }

    const groups = groupConnected(edges);
    const branchGroups = groups.filter(hasBranchVertex);
    return branchGroups.length === 0
        ? connectivityProfiles(groups, sketch.plane)
        : splitProfiles(groups, branchGroups, edges, sketch);
}

/**
 * A branch vertex (three or more edge endpoints at one point) cannot be chained into
 * a single simple wire — a figure-eight or T-junction would fold into one
 * self-intersecting loop. Decompose only those groups with the kernel, keeping the
 * remaining simple loops (nested ones included) on even-odd semantics.
 */
function splitProfiles(
    groups: IEdge[][],
    branchGroups: IEdge[][],
    edges: IEdge[],
    sketch: SketchNode,
): Result<SketchProfileSet> {
    const simpleGroups = groups.filter((group) => !hasBranchVertex(group));
    const empty = { outer: [] as IFace[], inner: [] as IFace[] };
    const simple =
        simpleGroups.length === 0 ? Result.ok(empty) : connectivityProfiles(simpleGroups, sketch.plane);
    if (!simple.isOk) return Result.err(simple.error);

    const entityIds = sketch.data.entities.map((entity) => entity.id);
    const idByEdge = new Map(edges.map((edge, index) => [edge, entityIds[index]]));
    const branchEdges = branchGroups.flat();
    const branch = crossingProfiles(
        branchEdges,
        branchEdges.map((edge) => idByEdge.get(edge)!),
        sketch,
    );
    if (!branch.isOk) return Result.err(branch.error);

    return Result.ok({
        outer: [...simple.value.outer, ...branch.value.outer],
        inner: simple.value.inner,
        outerEntities: [...simple.value.outer.map(() => undefined), ...(branch.value.outerEntities ?? [])],
    });
}

/** Kernel path: splits `edges` at their intersections and returns every minimal region. */
function crossingProfiles(edges: IEdge[], entityIds: number[], sketch: SketchNode): Result<SketchProfileSet> {
    const regions = shapeFactory.facesFromEdges(edges, sketch.plane);
    if (!regions.isOk) return Result.err(regions.error);
    const { faces, sources } = regions.value;
    // Input edge i is entity i of the sketch (generateShape combines one edge per
    // entity in `data.entities` order) — map the kernel's source indexes to the
    // entity ids, which survive endpoint drags and re-splits.
    const outerEntities = sources.map((set) => set.map((index) => entityIds[index]).sort((a, b) => a - b));
    for (const [index, face] of faces.entries()) {
        registerProfileEntities(face, outerEntities[index]);
    }
    return Result.ok({ outer: faces, inner: [], outerEntities });
}

/** Wire-based profiles via endpoint connectivity and even-odd nesting. */
function connectivityProfiles(groups: IEdge[][], plane: Plane): Result<{ outer: IFace[]; inner: IFace[] }> {
    const loops = buildWires(groups, plane);
    if (!loops.isOk) return Result.err(loops.error);
    const { wires, polygons } = loops.value;

    // containedIn[i][j] = loop j contains loop i; depth = number of containing loops.
    const containedIn = polygons.map((poly, i) =>
        polygons.map((other, j) => i !== j && loopContains(other, poly)),
    );
    const depth = containedIn.map((row) => row.filter(Boolean).length);
    return buildFaces(wires, containedIn, depth);
}

/**
 * Chains each connected edge group into a closed wire and samples it as a polygon.
 * Open groups (dangling chains) cannot form profiles and are skipped; only a sketch
 * without any closed loop fails.
 */
function buildWires(groups: IEdge[][], plane: Plane): Result<{ wires: IWire[]; polygons: Polygon[] }> {
    const wires: IWire[] = [];
    const polygons: Polygon[] = [];
    for (const group of groups) {
        const wire = shapeFactory.wire(group);
        if (!wire.isOk) return Result.err(wire.error);
        if (!wire.value.isClosed()) continue;
        wires.push(wire.value);
        polygons.push(sampleLoop(group, plane));
    }
    if (wires.length === 0) return Result.err("Sketch profile is not closed");
    return Result.ok({ wires, polygons });
}

/** Even-depth loops become profiles with their direct child loops as holes; odd-depth loops stay solid faces. */
function buildFaces(
    wires: IWire[],
    containedIn: boolean[][],
    depth: number[],
): Result<{ outer: IFace[]; inner: IFace[] }> {
    const outer: IFace[] = [];
    const inner: IFace[] = [];
    for (const [index, wire] of wires.entries()) {
        const isHole = depth[index] % 2 === 1;
        const holeWires = isHole
            ? []
            : wires.filter((_, j) => depth[j] === depth[index] + 1 && containedIn[j][index]);
        const face = shapeFactory.face([wire, ...holeWires]);
        if (!face.isOk) return Result.err(face.error);
        (isHole ? inner : outer).push(face.value);
    }
    return Result.ok({ outer, inner });
}

export interface ResolvedProfile {
    readonly face: IFace;
    /** Position in the combined `[...outer, ...inner]` list — keeps sketch-scoped seed ids stable. */
    readonly index: number;
}

/**
 * The profiles a feature should operate on: every outer profile (holes applied) when
 * `profiles` is undefined/empty, otherwise the profiles the stored refs re-match to
 * (see `matchProfileIndexes`) — an explicitly selected inner loop extrudes as a solid.
 */
export function resolveProfiles(sketch: SketchNode, profiles?: ProfileRef[]): Result<ResolvedProfile[]> {
    const profileSet = sketchProfiles(sketch);
    if (!profileSet.isOk) return Result.err(profileSet.error);
    if (profiles === undefined || profiles.length === 0) {
        return Result.ok(profileSet.value.outer.map((face, index) => ({ face, index })));
    }
    const all = allProfiles(profileSet.value);
    const indexes = matchProfileIndexes(all, profiles, profileEntitiesOf(profileSet.value));
    if (!indexes.isOk) return Result.err(indexes.error);
    return Result.ok(indexes.value.map((index) => ({ face: all[index], index })));
}

/** All selectable profiles — outer (with holes) first, then inner loops; matches the sketch's profile mesh order. */
export function allProfiles(profileSet: SketchProfileSet): IFace[] {
    return [...profileSet.outer, ...profileSet.inner];
}

/**
 * The entity-id sets parallel to `allProfiles` (undefined entries for inner profiles —
 * empty on the crossing path anyway), or undefined on the connectivity path.
 */
export function profileEntitiesOf(profileSet: SketchProfileSet): (number[] | undefined)[] | undefined {
    if (profileSet.outerEntities === undefined) return undefined;
    return [...profileSet.outerEntities, ...profileSet.inner.map(() => undefined)];
}

/**
 * Approximates a loop as a 2D polygon in sketch-plane coordinates. The edges are
 * walked in chain order — each edge starts where the previous one ended — so the
 * sampled points trace the loop boundary. Sampling the raw group order instead would
 * jump between non-adjacent edges and corrupt the containment test with spurious chords.
 */
function sampleLoop(edges: IEdge[], plane: Plane): Polygon {
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
function loopContains(outer: Polygon, inner: Polygon): boolean {
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

function collectEdges(shape: IShape): IEdge[] {
    if (shape.shapeType === ShapeTypes.edge) return [shape as IEdge];
    return shape.findSubShapes(ShapeTypes.edge) as IEdge[];
}

/**
 * True when the sketch needs the kernel's edge-splitting path: any intersection that is
 * not a plain vertex contact (both edges meeting at a shared endpoint) means an edge is
 * split at the contact — either two edges crossing mid-span, or one edge's endpoint
 * landing on the interior of another (a T-junction, e.g. a divider line whose ends sit
 * on a rectangle's edges). Vertex contacts need no splitting and stay on the
 * connectivity path.
 */
function needsKernelSplit(edges: IEdge[]): boolean {
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            // Bounding boxes that do not touch cannot intersect; skip the kernel call.
            if (!BoundingBox.isIntersect(edges[i].boundingBox(), edges[j].boundingBox())) continue;
            if (
                edges[i].intersect(edges[j]).some(({ point }) => !isVertexContact(edges[i], edges[j], point))
            ) {
                return true;
            }
        }
    }
    return false;
}

/** A contact at a shared endpoint of both edges is a plain vertex; anything else splits an edge. */
function isVertexContact(a: IEdge, b: IEdge, point: XYZ): boolean {
    return nearEndpoint(a, point) && nearEndpoint(b, point);
}

function nearEndpoint(edge: IEdge, point: XYZ): boolean {
    return (
        point.distanceTo(edge.startPoint()) < Precision.Distance ||
        point.distanceTo(edge.endPoint()) < Precision.Distance
    );
}

function groupConnected(edges: IEdge[]): IEdge[][] {
    const remaining = [...edges];
    const groups: IEdge[][] = [];
    while (remaining.length > 0) {
        // Seed each group from the first remaining edge — the lowest entity — so groups
        // come out in entity order. That order is stable under append: a newly added
        // entity carries a higher id and lands in a group after the existing ones, so
        // existing profiles keep their positional index (and thus their seed id).
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
function hasBranchVertex(group: IEdge[]): boolean {
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

function endpoints(edge: IEdge) {
    return [edge.startPoint(), edge.endPoint()];
}

function coincides(a: ReturnType<IEdge["startPoint"]>, b: ReturnType<IEdge["startPoint"]>): boolean {
    return a.distanceTo(b) < Precision.Distance;
}
