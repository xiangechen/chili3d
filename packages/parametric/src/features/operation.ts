// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Result, ShapeTypes, type TrackedShape } from "@chili3d/core";
import type { TrackedMethod } from "./boolean";
import {
    type CompletedTrackedHistory,
    completeTrackedHistory,
    type ShapeTracking,
    trackedAncestors,
} from "./feature";
import { bornEdgeIdMap, mapOperationIds } from "./operationIds";

/**
 * The join/cut/intersect a body-building feature (extrude, sweep) applies against the
 * chain input.
 *
 * The feature builds its geometry with kernel history (sketch-scoped ids), then the
 * tracked boolean merges it with the preceding feature's shape — downstream edge refs
 * (fillet/chamfer) keep their stable ids across rebuilds instead of re-matching
 * geometrically, where a large sketch edit strands them between look-alike candidates.
 */

/** Combines the feature's swept tool with the chain input and records the resulting id map. */
export function applyTrackedOperation(
    input: IShape,
    tracking: ShapeTracking,
    tracked: TrackedMethod,
    tool: { shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] },
): Result<IShape> {
    const result = tracked([input], [tool.shape]);
    if (!result.isOk) return Result.err(result.error);

    const completed = completeTrackedHistory([input, tool.shape], result.value);
    trackOperation(input, tracking, tool, completed, result.value);
    return Result.ok(result.value.shape);
}

/** Fills the tracking outputs from the operation's boolean history (see `mapOperationIds`). */
export function trackOperation(
    input: IShape,
    tracking: ShapeTracking,
    tool: { faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] },
    completed: CompletedTrackedHistory,
    result: TrackedShape,
): void {
    const shape = result.shape;
    // Both mappers consume the merge channel, so this is one of the few places that pays for
    // verifying it (see `trackedAncestors`).
    const ancestors = trackedAncestors(completed, result);
    tracking.outputFaceIds = mapOperationIds(
        input,
        tracking.inputFaceIds,
        tool.faceIds,
        completed.faceMap,
        ShapeTypes.face,
        ancestors.faceAncestors,
    );
    // The curves a join/cut carves derive from nothing in either operand — they are the
    // boundary between two faces that DO have ids, exactly as a boolean's carved curves are
    // (see `bornEdgeIdMap`).
    const bornEdges = bornEdgeIdMap(
        shape,
        completed.outputEdges,
        completed.outputFaces,
        tracking.outputFaceIds,
        (index) => completed.edgeMap[index] < 0,
    );
    tracking.outputEdgeIds = mapOperationIds(
        input,
        tracking.inputEdgeIds,
        tool.edgeIds,
        completed.edgeMap,
        ShapeTypes.edge,
        ancestors.edgeAncestors,
        (index) => bornEdges.get(index),
    );
}
