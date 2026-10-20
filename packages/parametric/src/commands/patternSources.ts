// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    isReferenceGeometryNode,
    ShapeNode,
    ShapeTypes,
    type VisualShapeData,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type { PatternLineSource, PatternPathSource } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { idIsShared } from "../features/trackedId";

/**
 * How a pattern's picked edges become the live references it stores: one edge for a line mode's
 * direction/axis, the whole set for a curve's path. Both are fingerprinted in the source node's
 * LOCAL frame and carry the node's tracked id when it has one (`PatternLineSource` /
 * `PatternPathSource` share that contract), and both go through `capturePickedEdge` so the id
 * and shared-piece rules cannot drift between the command and the re-pick sessions.
 */

/** The node's tracked edge ids, parallel to `findSubShapes(edge)` — undefined when untracked. */
export function trackedEdgeIds(node: ShapeNode): (string | undefined)[] | undefined {
    const tracker = isBodyTrackingNode(node) ? node : undefined;
    if (tracker === undefined) return undefined;
    const shape = tracker.shape;
    if (!shape.isOk) return [];
    return (shape.value.findSubShapes(ShapeTypes.edge) as IEdge[]).map((_, index) => tracker.edgeIdAt(index));
}

/**
 * One picked edge as a live reference. `edgeIds` is the node's `trackedEdgeIds` when the caller
 * already has it (the path captures it once for the whole set); omitted, it is read here.
 */
export function capturePickedEdge(
    node: ShapeNode,
    picked: VisualShapeData,
    edgeIds: readonly (string | undefined)[] | undefined = trackedEdgeIds(node),
): EdgeRef {
    const edge = picked.shape as unknown as IEdge;
    const tracker = isBodyTrackingNode(node) ? node : undefined;
    if (edgeIds === undefined || tracker === undefined) return captureEdgeRef(edge);
    const index = picked.indexes[0];
    const edgeId = index === undefined ? undefined : tracker.edgeIdAt(index);
    if (edgeId === undefined) {
        reportSilentIdLoss(tracker, "edge", "a picked pattern edge has no tracked id");
    }
    return captureEdgeRef(edge, edgeId, idIsShared(edgeIds, edgeId));
}

/** A single edge pick as a line-mode reference, or undefined when it is not an ordinary node edge. */
export function capturePatternLineSource(data: VisualShapeData): PatternLineSource | undefined {
    const node = data.owner.node;
    if (!(node instanceof ShapeNode) || isReferenceGeometryNode(node)) return undefined;
    return { nodeId: node.id, edge: capturePickedEdge(node, data) };
}

/**
 * A multi-edge pick as the path reference a curve pattern stores. The edges keep the PICK order
 * — the feature sorts them into one end-to-end chain on every rebuild, so the stored order
 * carries no meaning of its own.
 *
 * Undefined when the picks do not come from one ordinary shape node: a path runs across the
 * edges of a body (or a sketch), and mixing nodes would leave the stored frame ambiguous.
 */
export function capturePatternPathSource(shapes: readonly VisualShapeData[]): PatternPathSource | undefined {
    const first = shapes[0];
    if (first === undefined) return undefined;
    const node = first.owner.node;
    if (!(node instanceof ShapeNode) || isReferenceGeometryNode(node)) return undefined;
    if (shapes.some((shape) => shape.owner.node !== node)) return undefined;

    const edgeIds = trackedEdgeIds(node);
    return {
        nodeId: node.id,
        edges: shapes.map((picked) => capturePickedEdge(node, picked, edgeIds)),
    };
}
