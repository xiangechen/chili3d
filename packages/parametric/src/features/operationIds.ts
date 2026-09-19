// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IShape, type ShapeNode, ShapeTypes } from "@chili3d/core";
import { isBodyTrackingNode } from "./bodyTracking";
import { boundaryId, isPositionalId, mapAncestorIds, positionalId, uncontested } from "./trackedId";

/**
 * The three ways an operation's kernel history becomes stable tracked ids — one per operation
 * the feature list can run:
 *
 * - `mapBooleanIds` — a boolean between bodies;
 * - `mapOperationIds` — an extrude that joins/cuts/intersects with the chain input;
 * - `mapFusedIds` — the fuse of several swept prisms.
 *
 * All three share `mapAncestorIds` as their tail and, crucially, the same input **ordering
 * contract**: the kernel enumerates the main shape's sub-shapes first, then each tool's in
 * order, and the map indexes point into that enumeration. `completeTrackedHistory` (feature.ts)
 * establishes the contract; every caller here has to respect it. Each mapper also reads the
 * main/tool boundary from the tracked-id count when available, falling back to the input's own
 * sub-shape count when upstream tracking was lost.
 */

/**
 * Maps boolean history to stable ids, distinguishing what each output sub-shape came from.
 *
 * The kernel enumerates the main body's sub-shapes first, then each tool's in order, so:
 * main-body hits keep their id; tool hits inherit the tool's own tracked id (parametric tools)
 * or take a tool-scoped positional id; boolean-born sub-shapes (e.g. intersection edges) get
 * feature-scoped ids.
 *
 * The main/tool boundary is the tracked-id count when available, else the input shape's own
 * sub-shape count. That fallback matters: when upstream tracking was lost (`inputIds` empty),
 * main-body sub-shapes would otherwise leak into the tool ranges and get bogus tool ids.
 *
 * The kernel's full derivation pairs (`ancestors`) extend the single-valued map: a sub-shape
 * MERGED from several inputs (a face unified with a coplanar neighbor, an edge fused with a
 * collinear one) combines every ancestor's id into a compound (`combineIds`), so pieces of a
 * later re-split still intersect the stored id.
 */
export function mapBooleanIds(
    featureId: string,
    input: IShape,
    inputIds: readonly string[],
    tools: ShapeNode[],
    map: number[],
    type: (typeof ShapeTypes)["face" | "edge"],
    ancestors?: number[],
    bornId?: (outputIndex: number) => string | undefined,
): string[] {
    // The boundary is the tracked-id count when available, else the input shape's
    // own sub-shape count (upstream tracking lost): without it, main-body sub-shapes
    // would leak into the tool ranges and get bogus tool ids.
    const mainCount = Math.max(inputIds.length, input.findSubShapes(type).length);
    let start = mainCount;
    const ranges = tools.map((node) => {
        const count = node.shape.unchecked()!.findSubShapes(type).length;
        const range = { node, start, count };
        start += count;
        return range;
    });
    const idOfInput = (inputIndex: number, outputIndex: number): string => {
        if (inputIndex >= 0 && inputIndex < inputIds.length) return inputIds[inputIndex];
        // Untracked main-body hit or boolean-born sub-shape: stable feature-scoped id.
        if (inputIndex < mainCount) return positionalId(featureId, outputIndex);
        const range = ranges.find((x) => inputIndex >= x.start && inputIndex < x.start + x.count);
        if (range === undefined) return positionalId(featureId, outputIndex);
        const local = inputIndex - range.start;
        const node = range.node;
        const toolId = isBodyTrackingNode(node)
            ? type === ShapeTypes.face
                ? node.faceIdAt(local)
                : node.edgeIdAt(local)
            : undefined;
        if (toolId === undefined) return positionalId(`tool:${node.id}`, local);
        // A parametric tool's id may already be a compound (`combineIds` over a merge).
        // Prefix EVERY leaf: prefixing only the first leaks the rest into the host's id
        // space as bare ids, colliding with the seeds a direct boolean against those
        // bodies generates (`idsOverlap` would then match unrelated sub-shapes).
        return toolId
            .split("|")
            .map((x) => `tool:${node.id}:${x}`)
            .join("|");
    };
    return mapAncestorIds(featureId, map, ancestors, idOfInput, bornId);
}

/**
 * Maps the boolean history of a join/cut/intersect extrude to stable ids.
 *
 * The kernel enumerates the main body's sub-shapes first, then the tool's: main-body hits keep
 * the input's id, tool hits take the sweep's sketch-scoped id, and boolean-born sub-shapes
 * (e.g. intersection edges) get feature-scoped ids. The main/tool boundary is the tracked-id
 * count when available, else the input's own sub-shape count (the same untracked-upstream guard
 * as `mapBooleanIds`).
 *
 * The kernel's full derivation pairs (`ancestors`) extend the single-valued map: a sub-shape
 * MERGED from several inputs combines every ancestor's id into a compound (`combineIds`), so
 * pieces of a later re-split still intersect the stored id.
 *
 * The extrude's own new sub-shapes — the curves a join/cut carves — keep a POSITIONAL id here:
 * `bornEdgeIdMap` names them by the faces they join, and is wired into `mapBooleanIds` only, so
 * a cut's curves are named by content when it comes from the boolean FEATURE but not when it
 * comes from an `operation` on an extrude. Extending the wiring is the follow-up.
 */
export function mapOperationIds(
    featureId: string,
    input: IShape,
    inputIds: readonly string[],
    toolIds: readonly string[],
    map: number[],
    type: (typeof ShapeTypes)["face" | "edge"],
    ancestors?: number[],
): string[] {
    const mainCount = Math.max(inputIds.length, input.findSubShapes(type).length);
    const idOfInput = (inputIndex: number, outputIndex: number): string => {
        if (inputIndex >= 0 && inputIndex < inputIds.length) return inputIds[inputIndex];
        const toolIndex = inputIndex - mainCount;
        if (inputIndex < mainCount || toolIndex >= toolIds.length)
            return positionalId(featureId, outputIndex);
        return toolIds[toolIndex];
    };
    return mapAncestorIds(featureId, map, ancestors, idOfInput);
}

/**
 * The id of every sub-shape a boolean BIRTHED, by the inherited sub-shapes it borders.
 *
 * An operation's own new sub-shapes — the faces a fillet or a boolean builds, the
 * intersection curve of a cut — derive from nothing in either operand, so the kernel's
 * history reports them with no ancestor (`mapAncestorIds`) and they fall to an enumeration-
 * scoped positional id. But such a sub-shape IS the boundary between two neighbours that DO
 * have stable identities, and that pair names it: for an edge, the two faces it joins.
 *
 * The name is `boundaryId`'s — a conjunction of the faces the curve joins, atomic so a boundary
 * sharing a face with another stays distinct.
 *
 * Two guards on top, both because the pair is still a coarser name than the sub-shape:
 * - a neighbour whose own id is positional contributes nothing (the name has to be stable);
 * - a pair that names SEVERAL born sub-shapes names none of them — those keep their positional
 *   id rather than share one, which the matching layer would read as pieces of one sub-shape.
 */
export function bornEdgeIdMap(
    shape: IShape,
    edges: readonly IEdge[],
    outputFaces: readonly IFace[],
    outputFaceIds: readonly string[],
    isBorn: (outputIndex: number) => boolean,
): Map<number, string> {
    const candidates = new Map<number, string>();
    edges.forEach((edge, index) => {
        if (!isBorn(index)) return;
        try {
            const faces = edge.findAncestor(ShapeTypes.face, shape) as IFace[];
            const ids = faces.flatMap((face) => {
                const at = outputFaces.findIndex((candidate) => candidate.isSame(face));
                const id = at < 0 ? undefined : outputFaceIds[at];
                return id === undefined || isPositionalId(id) ? [] : [id];
            });
            if (ids.length > 0) candidates.set(index, boundaryId(ids));
        } catch {
            // A degenerate edge — it keeps its positional id.
        }
    });
    return uncontested(candidates);
}

/**
 * Maps fuse history to the per-profile tracked ids: the input enumerates the args
 * sub-shapes (profile 0) first, then each tool profile in order. Fuse-born
 * sub-shapes (e.g. merged seam faces) get feature-scoped ids.
 *
 * **The `ancestors` channel is consumed like `mapBooleanIds`'s**, with one difference:
 * a fuse reports the merged sub-shape of two touching prisms, so EVERY ancestor's id
 * belongs on the merged edge (a ref captured on either half has to keep intersecting it).
 * Callers pass the pairs `completeTrackedHistory` verified — the raw ones can name a
 * sub-shape the output does not touch (see `verifiedEdgeAncestors`).
 */
export function mapFusedIds(
    featureId: string,
    idsPerProfile: string[][],
    map: number[],
    ancestors?: readonly number[],
): string[] {
    const argsIds = idsPerProfile[0];
    let start = argsIds.length;
    const toolRanges = idsPerProfile.slice(1).map((ids) => {
        const range = { ids, start };
        start += ids.length;
        return range;
    });
    const idOfInput = (inputIndex: number, outputIndex: number): string => {
        if (inputIndex >= 0 && inputIndex < argsIds.length) return argsIds[inputIndex];
        const range = toolRanges.find((x) => inputIndex >= x.start && inputIndex < x.start + x.ids.length);
        return range === undefined
            ? positionalId(featureId, outputIndex)
            : range.ids[inputIndex - range.start];
    };
    return mapAncestorIds(featureId, map, ancestors, idOfInput);
}
