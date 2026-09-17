// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape } from "@chili3d/core";

/**
 * The stable-id / tracking surface `ParametricBodyNode` exposes so feature code can
 * map kernel sub-shape indexes back to stable ids without importing the node class
 * itself — importing it would close an import cycle (feature modules are imported by
 * the body node).
 */
export interface IBodyTrackingNode {
    faceIdAt(index: number): string | undefined;
    faceIndexById(id: string): number | undefined;
    /**
     * Indexes of every face whose tracked id overlaps `id` — an exact hit plus, for a
     * composite id (`combineIds`), each piece carrying one of its ancestor ids. A merged
     * face re-split by an upstream edit is found through this, where `faceIndexById`
     * misses. Empty when tracking is unavailable or nothing overlaps.
     */
    faceIndexesOfId(id: string): number[];
    edgeIdAt(index: number): string | undefined;
    edgeIndexById(id: string): number | undefined;
    /**
     * Indexes of every edge whose tracked id overlaps `id` — the edge counterpart of
     * `faceIndexesOfId`: the pieces of a boolean-split edge share one id, and a
     * collinear-merged edge carries a composite id. `edgeIndexById` returns only the
     * first exact hit, which cannot tell the pieces apart.
     */
    edgeIndexesOfId(id: string): number[];
}

/** Structural check — `ParametricBodyNode` is the only node exposing `faceIdAt`. */
export function isBodyTrackingNode<T>(node: T): node is T & IBodyTrackingNode {
    if (node == null) return false;
    return typeof (node as unknown as Partial<IBodyTrackingNode>).faceIdAt === "function";
}

/**
 * The chain state entering one feature-list index: the feature's input shape with
 * the tracked ids of that step. `shape` is undefined only at index 0 (an empty
 * chain start); the id arrays are undefined once any link cannot track.
 */
export interface FeatureTimelineState {
    readonly shape: IShape | undefined;
    readonly faceIds?: string[];
    readonly edgeIds?: string[];
}

/**
 * Timeline access a parametric body exposes so sketch external references can
 * resolve against the shape at their timeline anchor (`SketchData.refPositions`)
 * instead of the final shape — which may already have consumed the referenced
 * edge (a downstream cut). Kept structural for the same cycle reason as
 * `IBodyTrackingNode`.
 */
export interface IBodyTimelineNode extends IBodyTrackingNode {
    readonly featureCount: number;
    timelineStateAt(index: number): FeatureTimelineState | undefined;
    /**
     * Feature-list index the chain is rolled back to for a session preview
     * (`ParametricBodyNode.setRollbackIndex`); undefined in normal operation. While
     * set, the node's shape and timeline are a transient preview that lacks every
     * element born from a later feature: sketches not owning the session must not
     * re-resolve references against it (the session owner must — the rollback
     * reveals exactly the capture-time geometry it was drawn on).
     */
    readonly rollbackIndex?: number;
}

/** Structural check — `ParametricBodyNode` is the only node exposing `timelineStateAt`. */
export function isBodyTimelineNode<T>(node: T): node is T & IBodyTimelineNode {
    if (!isBodyTrackingNode(node)) return false;
    return typeof (node as unknown as Partial<IBodyTimelineNode>).timelineStateAt === "function";
}
