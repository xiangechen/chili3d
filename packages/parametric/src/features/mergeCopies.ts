// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Result, ShapeTypes } from "@chili3d/core";
import { completeTrackedHistory, type ShapeTracking, trackedAncestors } from "./feature";
import { bornEdgeIdMap, mapOperationIds } from "./operationIds";

/**
 * A tracked fuse of `input` and `copies`, with the ids mapped the way an operation between bodies
 * maps them (see `operationIds.ts`): main-body hits keep the input's id, tool hits take the copy's
 * id, a sub-shape merged from several operands carries every ancestor (`combineIds` through the
 * ancestors channel), and the curves the fuse carves where the copies meet the input are born
 * edges named by the faces they join. The plain fuse is the fallback with no ids at all, the same
 * degradation `boolean.ts` documents.
 *
 * Mirror and pattern are one operation, not two: a mirror is a pattern of ONE copy. What differs
 * is what the copies are CALLED — a pattern scopes each instance (`patternIds`), a mirror reflects
 * the input's own names off its plane (`mirroredIds`) — so the caller builds those two flat lists
 * and this does the rest. `boolean.ts`'s `evaluateTracked` has the same shape with its own mapper
 * (`mapBooleanIds`, which reads tool ids off the tool NODES rather than being handed a list); it is
 * left alone because that is a different mapper, not a different list of ids.
 *
 * The kernel enumerates the input's sub-shapes first, then each tool's in order (the
 * `completeTrackedHistory` contract); every copy enumerates exactly the input's sub-shapes (the 1:1
 * argument `mirror.ts` and `pattern.ts` each make), so the tool ids are one flat concatenation in
 * copy order.
 */
export function mergeTrackedCopies(
    input: IShape,
    copies: IShape[],
    toolFaceIds: readonly (string | undefined)[],
    toolEdgeIds: readonly (string | undefined)[],
    tracking: ShapeTracking,
): Result<IShape> {
    const tracked = shapeFactory.booleanFuseTracked?.bind(shapeFactory);
    if (tracked === undefined) return shapeFactory.booleanFuse([input], copies, true);
    const result = tracked([input], copies);
    if (!result.isOk) return Result.err(result.error);
    const completed = completeTrackedHistory([input, ...copies], result.value);
    // Both mappers below consume the merge channel, so this is one of the few places that pays
    // for verifying it (see `trackedAncestors`).
    const ancestors = trackedAncestors(completed, result.value);
    tracking.outputFaceIds = mapOperationIds(
        input,
        tracking.inputFaceIds,
        toolFaceIds,
        completed.faceMap,
        ShapeTypes.face,
        ancestors.faceAncestors,
    );
    // The curves the fuse carves where the copies meet the input derive from nothing in any
    // operand; they are named by the two faces they join (see `bornEdgeIdMap`).
    const bornEdges = bornEdgeIdMap(
        result.value.shape,
        completed.outputEdges,
        completed.outputFaces,
        tracking.outputFaceIds,
        (index) => completed.edgeMap[index] < 0,
    );
    tracking.outputEdgeIds = mapOperationIds(
        input,
        tracking.inputEdgeIds,
        toolEdgeIds,
        completed.edgeMap,
        ShapeTypes.edge,
        ancestors.edgeAncestors,
        (index) => bornEdges.get(index),
    );
    return Result.ok(result.value.shape);
}
