// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IWire, type Plane, Result } from "@chili3d/core";
import { shapeEntityIds } from "../sketch/sketchModel";
import type { SketchNode } from "../sketch/sketchNode";
import {
    attributeFaceEdges,
    registerProfileEdgeEntities,
    registerProfileEntities,
    registerRegionEdgeEntities,
    reportMissingEntityId,
    sourceEntityIds,
} from "./profileEntities";
import {
    collectEdges,
    groupConnected,
    hasBranchVertex,
    loopContains,
    needsKernelSplit,
    type Polygon,
    sampleLoop,
} from "./profileGeometry";
import { matchProfileIndexes } from "./profileMatcher";
import type { ProfileRef } from "./profileRef";
import { profileSeeds } from "./profileSeeds";

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

/**
 * Extrudable profiles of a sketch as faces. Two paths, chosen by whether the sketch's edges can
 * be trusted to form simple loops.
 *
 * - **Connectivity path (the common one).** Sketch entities are combined into a compound (they
 *   may be disjoint), so edges are first grouped by endpoint connectivity; the wire factory
 *   chains each group in place. Nested loops follow even-odd semantics: an inner loop becomes a
 *   hole of the containing profile instead of an independent face — unless explicitly selected,
 *   see `resolveProfiles`.
 * - **Kernel path.** When edges cross mid-span, land on another edge's interior (a T-junction,
 *   within `INCIDENCE_TOLERANCE`), or overlap collinearly, grouping cannot see the extra regions.
 *   The whole sketch then goes through `shapeFactory.facesFromEdges`, which splits the edges at
 *   their contacts and returns every minimal bounded region as a profile — even-odd no longer
 *   applies on that path.
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

/** Kernel path: splits `edges` at their intersections and returns every minimal region. */
function crossingProfiles(
    edges: IEdge[],
    entityIds: readonly (number | undefined)[],
    sketch: SketchNode,
): Result<SketchProfileSet> {
    const regions = shapeFactory.facesFromEdges(edges, sketch.plane);
    if (!regions.isOk) return Result.err(regions.error);
    const { faces, sources } = regions.value;

    const outerEntities = sources.map((set) => sourceEntityIds(set, entityIds, sketch));
    for (const [index, face] of faces.entries()) {
        registerProfileEntities(face, outerEntities[index]);
        registerRegionEdgeEntities(face, edges, sources[index], entityIds, sketch);
    }
    return Result.ok({ outer: faces, inner: [], outerEntities, innerEntities: [] });
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

/** All selectable profiles — outer (with holes) first, then inner loops; matches the sketch's profile mesh order. */
export function allProfiles(profileSet: SketchProfileSet): IFace[] {
    return [...profileSet.outer, ...profileSet.inner];
}

/** The entity-id sets parallel to `allProfiles`. */
export function profileEntitiesOf(profileSet: SketchProfileSet): (number[] | undefined)[] {
    return [...profileSet.outerEntities, ...profileSet.innerEntities];
}
