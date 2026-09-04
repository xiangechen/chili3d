// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
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

/** Samples per edge when approximating a loop as a polygon for the containment test. */
const LOOP_SAMPLES = 16;

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
     * apart, they share segments of the same entities).
     */
    readonly outerEntities?: number[][];
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

    if (hasMidSpanCrossing(edges)) {
        const regions = shapeFactory.facesFromEdges(edges, sketch.plane);
        if (!regions.isOk) return Result.err(regions.error);
        const { faces, sources } = regions.value;
        // Input edge i is entity i of the sketch (generateShape combines one edge per
        // entity in `data.entities` order) — map the kernel's source indexes to the
        // entity ids, which survive endpoint drags and re-splits.
        const outerEntities = sources.map((set) =>
            set.map((index) => sketch.data.entities[index].id).sort((a, b) => a - b),
        );
        for (const [index, face] of faces.entries()) {
            registerProfileEntities(face, outerEntities[index]);
        }
        return Result.ok({ outer: faces, inner: [], outerEntities });
    }

    const loops = buildWires(groupConnected(edges), sketch.plane);
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
function buildFaces(wires: IWire[], containedIn: boolean[][], depth: number[]): Result<SketchProfileSet> {
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

/** Approximates a loop as a 2D polygon in sketch-plane coordinates. */
function sampleLoop(edges: IEdge[], plane: Plane): Polygon {
    const points: Polygon = [];
    for (const edge of edges) {
        const start = edge.firstParameter();
        const end = edge.lastParameter();
        for (let i = 0; i < LOOP_SAMPLES; i++) {
            const point = edge.pointAt(start + ((end - start) * i) / LOOP_SAMPLES);
            const vec = point.sub(plane.origin);
            points.push([vec.dot(plane.xvec), vec.dot(plane.yvec)]);
        }
    }
    return points;
}

/** Majority vote: most of the inner loop's sampled points lie inside the outer polygon. */
function loopContains(outer: Polygon, inner: Polygon): boolean {
    const insideCount = inner.filter((point) => pointInPolygon(point, outer)).length;
    return insideCount > inner.length / 2;
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

/** True when any edge pair intersects away from both edges' endpoints. */
function hasMidSpanCrossing(edges: IEdge[]): boolean {
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            if (crossesMidSpan(edges[i], edges[j])) return true;
        }
    }
    return false;
}

/**
 * An intersection point counts as a crossing only when it is interior to both edges —
 * points near an endpoint (vertex contacts, T-junctions) are left to the connectivity
 * grouping path, which already handles them.
 */
function crossesMidSpan(a: IEdge, b: IEdge): boolean {
    return a.intersect(b).some(({ point }) => !nearEndpoint(a, point) && !nearEndpoint(b, point));
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
        const group = [remaining.pop()!];
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

function touches(group: IEdge[], edge: IEdge): boolean {
    return group.some((x) => endpoints(x).some((a) => endpoints(edge).some((b) => coincides(a, b))));
}

function endpoints(edge: IEdge) {
    return [edge.startPoint(), edge.endPoint()];
}

function coincides(a: ReturnType<IEdge["startPoint"]>, b: ReturnType<IEdge["startPoint"]>): boolean {
    return a.distanceTo(b) < Precision.Distance;
}
