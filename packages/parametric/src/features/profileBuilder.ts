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
import { INCIDENCE_TOLERANCE, shapeEntityIds } from "../sketch/sketchModel";
import type { SketchNode } from "../sketch/sketchNode";
import type { Vec3 } from "./edgeRef";
import {
    captureRegionFingerprint,
    matchProfileIndexes,
    type ProfileRef,
    profileEdgeEntityIds,
    profileEntityIds,
    registerProfileEdgeEntities,
    registerProfileEntities,
} from "./profileRef";

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
     * The sorted ids of the sketch entities bounding each `outer` profile — the
     * region's primary identity for `ProfileRef.entities` and for sketch-scoped seed
     * ids (geometric fingerprints cannot tell adjacent regions of a crossing sketch
     * apart, they share segments of the same entities, and positional indexes drift
     * when profiles are added or removed). Populated on every path (explicitly empty
     * where there are no such profiles); `undefined` entries appear only where
     * entity ids are unavailable (e.g. test mocks).
     */
    readonly outerEntities: (number[] | undefined)[];
    /** Same as `outerEntities`, parallel to `inner`. */
    readonly innerEntities: (number[] | undefined)[];
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
 * When edges cross mid-span, land on another edge's interior (a T-junction, within
 * `INCIDENCE_TOLERANCE`), or overlap collinearly, grouping cannot see the extra
 * regions, so the whole sketch goes through `shapeFactory.facesFromEdges`, which
 * splits the edges at their contacts and returns every minimal bounded region as a
 * profile (even-odd no longer applies on that path).
 */
export function sketchProfiles(sketch: SketchNode): Result<SketchProfileSet> {
    const shape = sketch.shape;
    if (!shape.isOk) return Result.err(shape.error);

    const edges = collectEdges(shape.value);
    if (edges.length === 0) return Result.err("Sketch has no entities");

    // Edge i was generated from sketch entity shapeEntityIds[i] (generateShape combines
    // one edge per entity, then the profile-role external refs) — the entity ids survive
    // endpoint drags and re-splits, unlike edge positions.
    const entityIds = shapeEntityIds(sketch.data);
    const idByEdge = new Map(edges.map((edge, index) => [edge, entityIds[index]]));

    // Mid-span crossings and T-junctions split edges into regions endpoint connectivity
    // cannot see, so the whole sketch goes through the kernel.
    if (needsKernelSplit(edges)) {
        return crossingProfiles(edges, entityIds, sketch);
    }

    const groups = groupConnected(edges);
    const branchGroups = groups.filter(hasBranchVertex);
    return branchGroups.length === 0
        ? connectivityProfiles(groups, sketch.plane, idByEdge)
        : splitProfiles(groups, branchGroups, idByEdge, sketch);
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
    idByEdge: Map<IEdge, number>,
    sketch: SketchNode,
): Result<SketchProfileSet> {
    const simpleGroups = groups.filter((group) => !hasBranchVertex(group));
    const empty: SketchProfileSet = { outer: [], inner: [], outerEntities: [], innerEntities: [] };
    const simple =
        simpleGroups.length === 0
            ? Result.ok(empty)
            : connectivityProfiles(simpleGroups, sketch.plane, idByEdge);
    if (!simple.isOk) return Result.err(simple.error);

    const branchEdges = branchGroups.flat();
    // Same lookup guarantee as buildWires: idByEdge covers every collected edge, so
    // the entity id cannot be missing on healthy data. A miss means the entity-id
    // list ran shorter than the edge list — undefined must not flow into the kernel
    // path's identity sets, so the misses are reported here (see
    // reportMissingEntityId) and crossingProfiles skips them.
    const branchEntityIds = branchEdges.map((edge) => idByEdge.get(edge));
    const missing = branchEntityIds.filter((id) => id === undefined).length;
    if (missing > 0) {
        reportMissingEntityId(sketch, `${missing} of ${branchEdges.length} branch edges have no entity id`);
    }
    const branch = crossingProfiles(branchEdges, branchEntityIds, sketch);
    if (!branch.isOk) return Result.err(branch.error);

    return Result.ok({
        outer: [...simple.value.outer, ...branch.value.outer],
        inner: simple.value.inner,
        outerEntities: [...simple.value.outerEntities, ...branch.value.outerEntities],
        innerEntities: simple.value.innerEntities,
    });
}

/**
 * Makes a missing entity id loud, in the spirit of `reportSilentIdLoss`
 * (features/idDiagnostics.ts): the edge list and the entity-id list are parallel on
 * every healthy path (generateShape builds one edge per entity, then the
 * profile-role external refs), so a miss means the kernel's source report and the
 * sketch have diverged. Silently stuffing undefined into a region's identity set
 * would degrade its ProfileRef to geometric matching only after a serialization
 * round-trip (undefined → null), far from the cause.
 */
function reportMissingEntityId(sketch: SketchNode, what: string): void {
    console.warn(
        `[chili3d] profile entity loss: ${what} (sketch ${sketch.id}) — the profile identity degrades to geometric matching. Please report this scenario.`,
    );
}

/** Kernel path: splits `edges` at their intersections and returns every minimal region. */
function crossingProfiles(
    edges: IEdge[],
    entityIds: readonly (number | undefined)[],
    sketch: SketchNode,
): Result<SketchProfileSet> {
    const regions = shapeFactory.facesFromEdges(edges, sketch.plane);
    if (!regions.isOk) return Result.err(regions.error);
    const { faces, sources } = regions.value;
    // Input edge i corresponds to shapeEntityIds[i] (generateShape combines one edge
    // per entity in `data.entities` order, then the profile-role external refs) — map
    // the kernel's source indexes to the entity ids, which survive endpoint drags and
    // re-splits. An index outside the entity list would stuff undefined into the
    // region's identity set: skip it (loudly) instead. An in-range miss was already
    // reported where the lookup dropped it (see splitProfiles).
    const outerEntities = sources.map((set) =>
        set
            .flatMap((index) => {
                if (index < 0 || index >= entityIds.length) {
                    reportMissingEntityId(
                        sketch,
                        `the kernel reported source edge ${index}, beyond the ${entityIds.length} entity ids`,
                    );
                    return [];
                }
                const id = entityIds[index];
                return id === undefined ? [] : [id];
            })
            .sort((a, b) => a - b),
    );
    for (const [index, face] of faces.entries()) {
        registerProfileEntities(face, outerEntities[index]);
        // A region's boundary edges are pieces the splitter cut from its source
        // edges — attribute each to the source entity it lies on.
        const candidates = sources[index].map((i) => edges[i]);
        registerProfileEdgeEntities(
            face,
            attributeFaceEdges(
                face,
                candidates,
                entityIdByEdge(candidates, entityIds, sources[index], sketch),
            ),
        );
    }
    return Result.ok({ outer: faces, inner: [], outerEntities, innerEntities: [] });
}

/** Candidate edge → entity id lookup for `attributeFaceEdges`. */
function entityIdByEdge(
    candidates: IEdge[],
    entityIds: readonly (number | undefined)[],
    sourceIndexes: number[],
    sketch: SketchNode,
): Map<IEdge, number> {
    const map = new Map<IEdge, number>();
    for (const [k, edge] of candidates.entries()) {
        const index = sourceIndexes[k];
        if (index < 0 || index >= entityIds.length) {
            reportMissingEntityId(
                sketch,
                `the kernel reported source edge ${index}, beyond the ${entityIds.length} entity ids`,
            );
            continue;
        }
        const id = entityIds[index];
        // An in-range miss was already reported where the lookup dropped it (see
        // splitProfiles); the edge keeps the positional seed fallback.
        if (id === undefined) continue;
        map.set(edge, id);
    }
    return map;
}

/**
 * The entity id each boundary edge of `face` was generated from, parallel to the
 * face's edge enumeration: an exact `isSame` hit first (a face shares the TShapes
 * of the edges it was built from; the kernel splitter also keeps untouched edges),
 * then an on-curve probe for split pieces (region edges are new TShapes cut from
 * the input edges). Undefined where neither matches — the seed falls back to the
 * positional ordinal there.
 */
function attributeFaceEdges(
    face: IFace,
    candidates: IEdge[],
    idByEdge: Map<IEdge, number>,
): (number | undefined)[] {
    let faceEdges: IEdge[];
    try {
        faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        // A mocked face without sub-shape access — no attribution, no seeds.
        return [];
    }
    return faceEdges.map((edge) => {
        const match =
            candidates.find((candidate) => safeIsSame(edge, candidate)) ??
            candidates.find((candidate) => safeLiesOn(edge, candidate));
        return match === undefined ? undefined : idByEdge.get(match);
    });
}

/** `edge.isSame(candidate)`, false when either side cannot be probed (a degenerate or mocked edge). */
function safeIsSame(edge: IEdge, candidate: IEdge): boolean {
    try {
        return edge.isSame(candidate);
    } catch {
        return false;
    }
}

/** `edgeLiesOn(edge, candidate)`, false when either side cannot be probed. */
function safeLiesOn(edge: IEdge, candidate: IEdge): boolean {
    try {
        return edgeLiesOn(edge, candidate);
    } catch {
        return false;
    }
}

/**
 * True when `piece` lies on `whole`'s trimmed curve (start/mid/end within
 * INCIDENCE_TOLERANCE — the solver's incidence-repair scale, so both layers agree
 * on "on the edge"). Probing the trimmed curve also rejects a collinear candidate
 * whose span does not reach the piece.
 */
function edgeLiesOn(piece: IEdge, whole: IEdge): boolean {
    const [t0, t1] = [piece.firstParameter(), piece.lastParameter()];
    return [t0, (t0 + t1) / 2, t1].every(
        (t) => whole.curve.nearestFromPoint(piece.pointAt(t)).distance < INCIDENCE_TOLERANCE,
    );
}

/** Wire-based profiles via endpoint connectivity and even-odd nesting. */
function connectivityProfiles(
    groups: IEdge[][],
    plane: Plane,
    idByEdge: Map<IEdge, number>,
): Result<SketchProfileSet> {
    const loops = buildWires(groups, plane, idByEdge);
    if (!loops.isOk) return Result.err(loops.error);
    const { wires, polygons, wireEntities, wireEdges } = loops.value;

    // containedIn[i][j] = loop j contains loop i; depth = number of containing loops.
    const containedIn = polygons.map((poly, i) =>
        polygons.map((other, j) => i !== j && loopContains(other, poly)),
    );
    const depth = containedIn.map((row) => row.filter(Boolean).length);
    return buildFaces(wires, wireEntities, wireEdges, idByEdge, containedIn, depth);
}

/**
 * Chains each connected edge group into a closed wire and samples it as a polygon.
 * Open groups (dangling chains) cannot form profiles and are skipped; only a sketch
 * without any closed loop fails.
 */
function buildWires(
    groups: IEdge[][],
    plane: Plane,
    idByEdge: Map<IEdge, number>,
): Result<{ wires: IWire[]; polygons: Polygon[]; wireEntities: number[][]; wireEdges: IEdge[][] }> {
    const wires: IWire[] = [];
    const polygons: Polygon[] = [];
    const wireEntities: number[][] = [];
    const wireEdges: IEdge[][] = [];
    for (const group of groups) {
        const wire = shapeFactory.wire(group);
        if (!wire.isOk) return Result.err(wire.error);
        if (!wire.value.isClosed()) continue;
        wires.push(wire.value);
        polygons.push(sampleLoop(group, plane));
        wireEdges.push(group);
        // The sorted unique entity ids of the loop's edges — the profile's identity,
        // stable across reordering and geometry edits (entity ids are never reused).
        // The filter only guards pathological data (an entity-id list shorter than
        // the edge list): on every healthy path generateShape builds one edge per
        // entity, so the lookup cannot miss.
        wireEntities.push(
            [
                ...new Set(
                    group.map((edge) => idByEdge.get(edge)).filter((id): id is number => id !== undefined),
                ),
            ].sort((a, b) => a - b),
        );
    }
    if (wires.length === 0) return Result.err("Sketch profile is not closed");
    return Result.ok({ wires, polygons, wireEntities, wireEdges });
}

/** Even-depth loops become profiles with their direct child loops as holes; odd-depth loops stay solid faces. */
function buildFaces(
    wires: IWire[],
    wireEntities: number[][],
    wireEdges: IEdge[][],
    idByEdge: Map<IEdge, number>,
    containedIn: boolean[][],
    depth: number[],
): Result<SketchProfileSet> {
    const outer: IFace[] = [];
    const inner: IFace[] = [];
    const outerEntities: number[][] = [];
    const innerEntities: number[][] = [];
    for (const [index, wire] of wires.entries()) {
        const isHole = depth[index] % 2 === 1;
        const holeIndexes = isHole
            ? []
            : wires.flatMap((_, j) => (depth[j] === depth[index] + 1 && containedIn[j][index] ? [j] : []));
        const face = shapeFactory.face([wire, ...holeIndexes.map((j) => wires[j])]);
        if (!face.isOk) return Result.err(face.error);
        // The outer wire's entities are the profile's identity; hole wires are incidental.
        registerProfileEntities(face.value, wireEntities[index]);
        // Boundary edges of the outer AND hole wires are the face's seed candidates.
        registerProfileEdgeEntities(
            face.value,
            attributeFaceEdges(
                face.value,
                [index, ...holeIndexes].flatMap((j) => wireEdges[j]),
                idByEdge,
            ),
        );
        if (isHole) {
            inner.push(face.value);
            innerEntities.push(wireEntities[index]);
        } else {
            outer.push(face.value);
            outerEntities.push(wireEntities[index]);
        }
    }
    return Result.ok({ outer, inner, outerEntities, innerEntities });
}

export interface ResolvedProfile {
    readonly face: IFace;
    /** Position in the combined `[...outer, ...inner]` list — indexes the profile mesh ranges. */
    readonly index: number;
    /**
     * Stable identity of the profile for sketch-scoped seed ids: `e{id.id...}` of the
     * sorted bounding entity ids (they survive profile reordering, addition and
     * geometry edits — entity ids are never reused), the positional index otherwise.
     * Profiles bounded by the same entity set (crossing-path lens regions) are told
     * apart by an occurrence suffix, stable while the kernel enumerates unchanged
     * geometry deterministically.
     */
    readonly seed: string;
}

/**
 * The profiles a feature should operate on: every outer profile (holes applied) when
 * `profiles` is undefined/empty, otherwise the profiles the stored refs re-match to
 * (see `matchProfileIndexes`) — an explicitly selected inner loop extrudes as a solid.
 */
export function resolveProfiles(sketch: SketchNode, profiles?: ProfileRef[]): Result<ResolvedProfile[]> {
    const profileSet = sketchProfiles(sketch);
    if (!profileSet.isOk) return Result.err(profileSet.error);
    const all = allProfiles(profileSet.value);
    const seeds = profileSeeds(all);
    if (profiles === undefined || profiles.length === 0) {
        return Result.ok(profileSet.value.outer.map((face, index) => ({ face, index, seed: seeds[index] })));
    }
    const indexes = matchProfileIndexes(all, profiles, profileEntitiesOf(profileSet.value));
    if (!indexes.isOk) return Result.err(indexes.error);
    return Result.ok(indexes.value.map((index) => ({ face: all[index], index, seed: seeds[index] })));
}

/**
 * Seed keys parallel to `all`: `e{id.id...}` of the sorted bounding entity ids,
 * falling back to the positional index when entity ids are unknown. Profiles bounded
 * by the same entity set (crossing-path lens regions) are told apart by an occurrence
 * suffix assigned in region-fingerprint order — content-derived, so the suffix
 * follows the region rather than the kernel's enumeration order. Computed over the
 * FULL profile list: the occurrence suffix of a duplicated entity set must not depend
 * on which profiles the feature selected.
 */
function profileSeeds(all: IFace[]): string[] {
    const groups = new Map<string, number[]>();
    all.forEach((face, index) => {
        const entities = profileEntityIds(face);
        const key = entities === undefined ? `${index}` : `e${entities.join(".")}`;
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [index]);
        else group.push(index);
    });
    const seeds = new Array<string>(all.length);
    for (const [key, group] of groups) {
        if (group.length === 1) {
            seeds[group[0]] = key;
            continue;
        }
        // Fingerprints are captured once per face — the comparator must stay pure,
        // and each capture is two kernel queries.
        const ranked = group
            .map((index) => ({ index, region: captureRegionFingerprint(all[index]) }))
            .sort((a, b) => compareRegionFingerprints(a.region, b.region));
        ranked.forEach(({ index }, occurrence) => {
            seeds[index] = occurrence === 0 ? key : `${key}~${occurrence}`;
        });
    }
    return seeds;
}

/** Region-fingerprint order (bbox center, then area) — the tiebreak recipe of `matchProfileIndexes`. */
function compareRegionFingerprints(
    a: { center: Vec3; area: number },
    b: { center: Vec3; area: number },
): number {
    return a.center.x - b.center.x || a.center.y - b.center.y || a.center.z - b.center.z || a.area - b.area;
}

/**
 * Sketch-scoped seeds of a profile face's boundary edges for swept sub-shape ids:
 * `ent<entityId>` of the sketch entity that generated the edge — entity ids survive
 * wire re-enumeration, where positional ordinals silently realign onto another edge
 * when a mirrored or rewound profile permutes the edge order. The ordinal remains
 * the fallback where entity attribution is unavailable (e.g. test mocks).
 *
 * `edges` must be the face's OWN `findSubShapes(ShapeTypes.edge)` enumeration in
 * the same order — the registered entity attribution (`profileEdgeEntityIds`) runs
 * parallel to it.
 */
export function profileEdgeSeeds(face: IFace, baseSeed: string, edges: IEdge[]): string[] {
    const entities = profileEdgeEntityIds(face);
    return edges.map((_, index) => {
        const entity = entities?.[index];
        return entity === undefined ? `${baseSeed}:e${index}` : `${baseSeed}:ent${entity}`;
    });
}

/** All selectable profiles — outer (with holes) first, then inner loops; matches the sketch's profile mesh order. */
export function allProfiles(profileSet: SketchProfileSet): IFace[] {
    return [...profileSet.outer, ...profileSet.inner];
}

/** The entity-id sets parallel to `allProfiles`. */
export function profileEntitiesOf(profileSet: SketchProfileSet): (number[] | undefined)[] {
    return [...profileSet.outerEntities, ...profileSet.innerEntities];
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
function needsKernelSplit(edges: IEdge[]): boolean {
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

function groupConnected(edges: IEdge[]): IEdge[][] {
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

function endpoints(edge: IEdge): [XYZ, XYZ] {
    return [edge.startPoint(), edge.endPoint()];
}

function coincides(a: ReturnType<IEdge["startPoint"]>, b: ReturnType<IEdge["startPoint"]>): boolean {
    return a.distanceTo(b) < Precision.Distance;
}
