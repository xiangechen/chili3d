// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, type ShapeNode, ShapeTypes } from "@chili3d/core";
import { isBodyTrackingNode } from "./bodyTracking";
import { mapAncestorIds } from "./trackedId";

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
        if (inputIndex < mainCount) return `${featureId}:${outputIndex}`;
        const range = ranges.find((x) => inputIndex >= x.start && inputIndex < x.start + x.count);
        if (range === undefined) return `${featureId}:${outputIndex}`;
        const local = inputIndex - range.start;
        const node = range.node;
        const toolId = isBodyTrackingNode(node)
            ? type === ShapeTypes.face
                ? node.faceIdAt(local)
                : node.edgeIdAt(local)
            : undefined;
        if (toolId === undefined) return `tool:${node.id}:${local}`;
        // A parametric tool's id may already be a compound (`combineIds` over a merge).
        // Prefix EVERY leaf: prefixing only the first leaks the rest into the host's id
        // space as bare ids, colliding with the seeds a direct boolean against those
        // bodies generates (`idsOverlap` would then match unrelated sub-shapes).
        return toolId
            .split("|")
            .map((x) => `tool:${node.id}:${x}`)
            .join("|");
    };
    return mapAncestorIds(featureId, map, ancestors, idOfInput);
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
        if (inputIndex < mainCount || toolIndex >= toolIds.length) return `${featureId}:${outputIndex}`;
        return toolIds[toolIndex];
    };
    return mapAncestorIds(featureId, map, ancestors, idOfInput);
}

/**
 * Maps fuse history to the per-profile tracked ids: the input enumerates the args
 * sub-shapes (profile 0) first, then each tool profile in order. Fuse-born
 * sub-shapes (e.g. merged seam faces) get feature-scoped ids.
 */
export function mapFusedIds(featureId: string, idsPerProfile: string[][], map: number[]): string[] {
    const argsIds = idsPerProfile[0];
    let start = argsIds.length;
    const toolRanges = idsPerProfile.slice(1).map((ids) => {
        const range = { ids, start };
        start += ids.length;
        return range;
    });
    return map.map((inputIndex, outputIndex) => {
        if (inputIndex >= 0 && inputIndex < argsIds.length) return argsIds[inputIndex];
        const range = toolRanges.find((x) => inputIndex >= x.start && inputIndex < x.start + x.ids.length);
        return range === undefined ? `${featureId}:${outputIndex}` : range.ids[inputIndex - range.start];
    });
}
