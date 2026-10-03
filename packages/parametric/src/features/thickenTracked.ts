// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IShape, Result, ShapeTypes, type TrackedShape } from "@chili3d/core";
import { type CompletedTrackedHistory, completeTrackedHistory, trackedFaceIds, trackedIds } from "./feature";
import { distance, MATCH_TOLERANCE } from "./refGeometry";
import { combineShapes } from "./sweepGeometry";
import { fuseSweptPrisms, uncontestedPerShape } from "./sweepTracked";
import { boundaryId, derivedId, writeUncontestedIds } from "./trackedId";

/**
 * The tracked counterpart of `makeThickSolidBySimple`, i.e. of Onshape's Thicken: a face (or a
 * connected face set, as one shell) is offset by a thickness into a solid, and every sub-shape
 * it builds is named from the source face it was built on.
 *
 * **What the kernel reports, measured on a box top offset by -2** (the whole design follows from
 * these three facts, which are why the sweep half of this module could not be reused):
 *
 * 1. The output is `1 kept face + r rim faces + 1 offset face` — the rim is raised around the
 *    face's WHOLE boundary, one band per boundary edge (6 faces for a quad: the kept top at
 *    z = 30, four 2mm bands at z = 29, and the copy at z = 28). A connected face set behaves as
 *    one surface: its INTERNAL edges raise no rim (measured on a box top + side: 7 shell edges,
 *    one of them shared, 6 rim faces).
 * 2. The derivation pairs are USELESS for telling the copy from the kept face: both are reported
 *    from the same input face (`in0->[0,2]` — the kept top and its copy) and every input EDGE
 *    likewise maps to its kept and its offset image (`in0->[0,7]`). Both channels therefore come
 *    from the kernel's dedicated `offsetFaceMap`/`offsetEdgeMap` instead (see their doc in
 *    `shapeFactory.ts`); reading the pairs alone would stamp one id on two distinct faces.
 * 3. The rim has NO derivation at all — `faceEdgeMap` comes back all -1 and the rim's vertical
 *    corner edges are absent from the edge pairs entirely. Rim faces and rim corner edges are
 *    named GEOMETRICALLY below (`attributeRimFaces` / `attributeRimEdges`), which is why this
 *    module needs an attribution pass the sweep never did.
 */

/**
 * The component of a thicken sub-shape name that marks it as the wall this feature raised (see
 * `boundaryId`), the counterpart of the sweep's `PUSH_MARKER`: the source face's own id lives in
 * the body's id space too, so a rim named after it alone would collide with the face it stands
 * on.
 */
const THICKEN_MARKER = "thicken";

/** One kernel call's input: the face set as a single shape, plus the ids of its sub-shapes. */
export interface ThickenInput {
    /** The shell of a connected face set, or a lone face — what the kernel is asked to offset. */
    readonly shape: IShape;
    /** Tracked ids of `shape`'s faces, in its `findSubShapes` order. */
    readonly faceIds: readonly (string | undefined)[];
    /** Tracked ids of `shape`'s edges, in its `findSubShapes` order. */
    readonly edgeIds: readonly (string | undefined)[];
}

/** A thicken result with the stable ids of every sub-shape it built, in findSubShapes order. */
export interface ThickenIds {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Groups `faces` into connected components (edge-adjacent) and wraps each as the kernel input of
 * one thicken call, its face/edge ids matched back to the source.
 *
 * The grouping is not an optimization: two DISCONNECTED faces handed over as one shell fail
 * outright (measured: `MakeThickSolidBySimple` on a shell of a box's bottom and top returns
 * "Failed to create thick solid"), and a connected set must go in as ONE shell so the edges the
 * faces share raise no rim between them.
 *
 * `edgeIdsOf(k)` is the k-th face's own edge ids in that face's `findSubShapes(edge)` order —
 * the caller's source-face ids, which is what seeds the rim names.
 */
export function thickenInputsOf(
    faces: readonly IFace[],
    faceIds: readonly (string | undefined)[],
    edgeIdsOf: (faceIndex: number) => readonly (string | undefined)[] | undefined,
): Result<ThickenInput[]> {
    const groups = connectedFaceGroups(faces);
    const inputs: ThickenInput[] = [];
    for (const group of groups) {
        // A lone face goes to the kernel as itself — the app's thick-solid command does the
        // same, and wrapping it in a shell only adds a step that can fail.
        let input: IShape;
        if (group.length === 1) {
            input = faces[group[0]];
        } else {
            const shell = shapeFactory.shell(group.map((k) => faces[k]));
            if (!shell.isOk) return Result.err(shell.error);
            input = shell.value;
        }
        inputs.push({
            shape: input,
            faceIds: inputFaceIds(input, faces, faceIds),
            edgeIds: inputEdgeIds(input, faces, edgeIdsOf),
        });
    }
    return Result.ok(inputs);
}

/** `input`'s faces' ids, matched back to the source faces they came from (undefined if unmatched). */
function inputFaceIds(
    input: IShape,
    faces: readonly IFace[],
    faceIds: readonly (string | undefined)[],
): (string | undefined)[] {
    return (input.findSubShapes(ShapeTypes.face) as IFace[]).map(
        (face) => faceIds[sameIndex(face, faces as IFace[])],
    );
}

/**
 * `input`'s edges' ids: each edge belongs to one of the source faces, so it takes that face's own
 * edge id (`edgeIdsOf`). A face's edges ARE the shape's edges — its boundary is a subset, not a
 * copy — so `isSame` finds each, exactly as `faceEdgeIds` in `sourceFaceMatcher.ts` relies on.
 */
function inputEdgeIds(
    input: IShape,
    faces: readonly IFace[],
    edgeIdsOf: (faceIndex: number) => readonly (string | undefined)[] | undefined,
): (string | undefined)[] {
    const sourceEdges = faces.map((face) => safeEdges(face));
    const sourceIds = faces.map((_, index) => edgeIdsOf(index));
    return safeEdges(input).map((edge) => {
        for (let k = 0; k < faces.length; k++) {
            const ids = sourceIds[k];
            if (ids === undefined) continue;
            const index = sourceEdges[k].findIndex((candidate) => candidate.isSame(edge));
            if (index >= 0) return ids[index];
        }
        return undefined;
    });
}

/**
 * Faces grouped by edge adjacency — one group per connected surface, the components
 * `thickenInputsOf` thickens as separate solids (and the command previews the same way).
 */
export function connectedFaceGroups(faces: readonly IFace[]): number[][] {
    const edges = faces.map((face) => safeEdges(face));
    const parent = faces.map((_, index) => index);
    const find = (index: number): number => {
        let root = index;
        while (parent[root] !== root) root = parent[root];
        return root;
    };
    for (let a = 0; a < faces.length; a++) {
        for (let b = a + 1; b < faces.length; b++) {
            if (!edges[a].some((edge) => edges[b].some((other) => edge.isSame(other)))) continue;
            parent[find(a)] = find(b);
        }
    }
    const groups = new Map<number, number[]>();
    for (let index = 0; index < faces.length; index++) {
        const root = find(index);
        groups.set(root, [...(groups.get(root) ?? []), index]);
    }
    return [...groups.values()];
}

/** A face's (or shell's) edges; a degenerate one contributes none rather than throwing. */
function safeEdges(shape: IShape): IEdge[] {
    try {
        return shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        return [];
    }
}

/** The index of the shape `isSame` as `target`, or -1 — a degenerate candidate is skipped. */
function sameIndex(target: IShape, candidates: IShape[]): number {
    return candidates.findIndex((candidate) => {
        try {
            return candidate.isSame(target);
        } catch {
            return false;
        }
    });
}

/**
 * Offsets one connected face set, once per signed thickness, naming every sub-shape the kernel
 * builds. `thicknesses` holds one signed value per logical direction (`:neg` qualifies the ids of
 * every direction after the first, so a symmetric thicken's two halves cannot duplicate names).
 *
 * Returns `undefined` when the kernel offers no tracked thicken — the caller then takes the plain
 * path, which builds the same geometry with no ids at all.
 */
export function thickenTracked(
    input: ThickenInput,
    thicknesses: readonly number[],
): Result<ThickenIds> | undefined {
    if (shapeFactory.makeThickSolidBySimpleTracked === undefined) return undefined;
    const built: ThickenIds[] = [];
    for (const [direction, thickness] of thicknesses.entries()) {
        const one = thickenOnce(input, thickness, direction === 0 ? "" : ":neg");
        if (!one.isOk) return Result.err(one.error);
        built.push(one.value);
    }
    if (built.length === 1) return Result.ok(built[0]);
    return fuseHalves(built);
}

/**
 * One kernel call, with the ids of everything it built.
 *
 * The naming, in the order the three kinds of sub-shape become nameable:
 * - **kept face / kept boundary edge** — the input's own id, inherited through the history
 *   (`trackedFaceIds`/`trackedIds`).
 * - **offset face / offset edge** — `<source id>:offset`, from the kernel's offset channels.
 * - **rim face / rim corner edge** — geometric attribution (the kernel reports neither).
 */
function thickenOnce(input: ThickenInput, thickness: number, seedSuffix: string): Result<ThickenIds> {
    const result = shapeFactory.makeThickSolidBySimpleTracked!(input.shape, thickness);
    if (!result.isOk) return Result.err(result.error);
    const tracked: TrackedShape = result.value;
    const completed = completeTrackedHistory([input.shape], tracked, {
        inputFaces: input.shape.findSubShapes(ShapeTypes.face) as IFace[],
        inputEdges: safeEdges(input.shape),
    });
    // The offset channels are consulted before the rims: a copy and the wall it was offset from
    // are the two sub-shapes the derivation pairs conflate, so the rim pass must see which output
    // faces and edges are already spoken for.
    const offsets = {
        faces: tracked.offsetFaceMap ?? [],
        edges: tracked.offsetEdgeMap ?? [],
    };
    const faceIds = trackedFaceIds(input.faceIds, input.edgeIds, completed.faceMap);
    seedOffsetFaces(faceIds, input.faceIds, offsets.faces, seedSuffix);
    const edgeIds = trackedIds(input.edgeIds, completed.edgeMap);
    seedOffsetEdges(edgeIds, input, offsets, seedSuffix);
    attributeRimFaces(faceIds, input.edgeIds, completed, offsets.edges, seedSuffix);
    attributeRimEdges(edgeIds, input.edgeIds, completed, offsets.edges, seedSuffix);
    return Result.ok({ shape: tracked.shape, faceIds, edgeIds });
}

/** Names the parallel copy of each input face — `<source face id>:offset`. */
function seedOffsetFaces(
    faceIds: (string | undefined)[],
    inputFaceIds: readonly (string | undefined)[],
    offsetFaces: readonly number[],
    seedSuffix: string,
): void {
    offsetFaces.forEach((inputIndex, outputIndex) => {
        const id = inputFaceIds[inputIndex];
        if (id !== undefined && outputIndex < faceIds.length) {
            faceIds[outputIndex] = qualify(derivedId(id, ":offset"), seedSuffix);
        }
    });
}

/**
 * Names the parallel copy of each input boundary edge. The copy of the edge standing on input edge
 * `j` belongs to the same wall as the rim raised over it, so it is named under that wall's name:
 * `<thicken&<edge id>>:offset` — a name that says which edge it was offset from AND that it is the
 * far side of that wall.
 */
function seedOffsetEdges(
    edgeIds: (string | undefined)[],
    input: ThickenInput,
    offsets: { faces: readonly number[]; edges: readonly number[] },
    seedSuffix: string,
): void {
    offsets.edges.forEach((inputIndex, outputIndex) => {
        const id = input.edgeIds[inputIndex];
        if (id === undefined || outputIndex >= edgeIds.length) return;
        edgeIds[outputIndex] = qualify(derivedId(wallId(id), ":offset"), seedSuffix);
    });
}

/** The name of the wall raised over the boundary edge named `edgeId`. */
function wallId(edgeId: string): string {
    return boundaryId([THICKEN_MARKER, edgeId]);
}

/** `id` under this direction's scope (empty for the first direction — see `thickenOnce`). */
function qualify(id: string, seedSuffix: string): string {
    return seedSuffix === "" ? id : derivedId(id, seedSuffix);
}

/**
 * Names the rim faces — the bands raised along the boundary.
 *
 * The kernel reports nothing for them (`faceEdgeMap` is all -1), so each is attributed by the one
 * boundary edge it stands on, which the geometry gives away: a rim face's boundary contains
 * EXACTLY ONE kept edge (the source boundary edge's own image) and the copy of that edge on the
 * far side. The kept edge's tracked ancestor is therefore the rim's generator.
 *
 * A face with no single kept edge on its boundary — a shape the linear thicken does not produce —
 * stays unnamed rather than take a guess.
 */
function attributeRimFaces(
    faceIds: (string | undefined)[],
    inputEdgeIds: readonly (string | undefined)[],
    completed: CompletedTrackedHistory,
    offsetEdges: readonly number[],
    seedSuffix: string,
): void {
    const candidates = new Map<number, string>();
    completed.outputFaces.forEach((face, index) => {
        if (completed.faceMap[index] >= 0 || faceIds[index] !== undefined) return;
        const generator = rimGenerator(face, completed, offsetEdges);
        const edgeId = generator === undefined ? undefined : inputEdgeIds[generator];
        if (edgeId !== undefined) candidates.set(index, qualify(wallId(edgeId), seedSuffix));
    });
    writeUncontestedIds(faceIds, candidates);
}

/** The input boundary edge the rim face `face` stands on: its single kept boundary edge's ancestor. */
function rimGenerator(
    face: IFace,
    completed: CompletedTrackedHistory,
    offsetEdges: readonly number[],
): number | undefined {
    const kept = safeEdges(face).map((edge) => sameIndex(edge, completed.outputEdges));
    const surviving = kept.filter(
        (index) => index >= 0 && completed.edgeMap[index] >= 0 && (offsetEdges[index] ?? -1) < 0,
    );
    if (surviving.length !== 1) return undefined;
    return completed.edgeMap[surviving[0]];
}

/**
 * Names the rim's vertical corner edges — the ones standing at a boundary vertex, from the kept
 * edge to its copy. They carry no history at all (measured: absent from the edge pairs), so each
 * is attributed by the two kept edges whose ends it meets: at a boundary vertex exactly two kept
 * edges touch, which is the pair that names the corner.
 *
 * A corner edge meeting anything other than exactly two kept edges stays unnamed.
 */
function attributeRimEdges(
    edgeIds: (string | undefined)[],
    inputEdgeIds: readonly (string | undefined)[],
    completed: CompletedTrackedHistory,
    offsetEdges: readonly number[],
    seedSuffix: string,
): void {
    const kept = completed.outputEdges
        .map((_, index) => index)
        .filter((index) => completed.edgeMap[index] >= 0 && (offsetEdges[index] ?? -1) < 0);
    const candidates = new Map<number, string>();
    completed.outputEdges.forEach((edge, index) => {
        if (edgeIds[index] !== undefined) return;
        const ids = [
            ...new Set(
                kept
                    .filter((k) => sharesEndPoint(edge, completed.outputEdges[k]))
                    .map((k) => inputEdgeIds[completed.edgeMap[k]])
                    .filter((id): id is string => id !== undefined),
            ),
        ];
        if (ids.length === 2) {
            candidates.set(index, qualify(boundaryId([THICKEN_MARKER, ...ids]), seedSuffix));
        }
    });
    writeUncontestedIds(edgeIds, candidates);
}

/** True when `a` and `b` share an end point — a closed edge's two kinds of end coincide. */
function sharesEndPoint(a: IEdge, b: IEdge): boolean {
    try {
        const endsA = [a.startPoint(), a.endPoint()];
        const endsB = [b.startPoint(), b.endPoint()];
        return endsA.some((x) => endsB.some((y) => distance(x, y) <= MATCH_TOLERANCE));
    } catch {
        // A degenerate edge — it names no corner.
        return false;
    }
}

/** Fuses the two directions of a symmetric / two-sided thicken into one solid, ids merged. */
function fuseHalves(built: readonly ThickenIds[]): Result<ThickenIds> {
    const shapes = built.map((x) => x.shape);
    const faceIds = uncontestedPerShape(built.map((x) => x.faceIds));
    const edgeIds = uncontestedPerShape(built.map((x) => x.edgeIds));
    const fused = fuseSweptPrisms(shapes, faceIds, edgeIds);
    if (fused !== undefined) return Result.ok(fused.value);
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: faceIds.flat(), edgeIds: edgeIds.flat() });
}
