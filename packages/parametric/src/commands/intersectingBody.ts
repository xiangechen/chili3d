// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IDocument } from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";

/**
 * The join/cut/intersect targets, auto-detected: every parametric body whose bounding box
 * intersects the tool's, in tree order.
 *
 * Bounds only, deliberately. The test runs on every drag tick against a tool that is
 * moving, so a real interference check (a boolean per candidate, per tick) would be paid
 * for on the interactive path — and the cost of NOT having it is small: boxes that overlap
 * where the geometry does not produce a no-op boolean, and a body listed as a target
 * combines with nothing. What the user sees in the panel while dragging is therefore a
 * superset; they uncheck what they did not mean. `booleanTargets.syncAutoTargets` explains
 * why an unchanged set is not repainted.
 *
 * "New" bypasses this and stands the feature up as its own body.
 *
 * `box` is the tool's box in WORLD coordinates (callers build it from world-space picks),
 * and a body's shape lives in its own local space, so its box is transformed before the
 * comparison — moving or rotating a body must not change what it can be joined into.
 */
export function findIntersectingBodies(document: IDocument, box: BoundingBox): ParametricBodyNode[] {
    return document.modelManager.findNodes(
        (node) =>
            node instanceof ParametricBodyNode &&
            node.shape.isOk &&
            BoundingBox.isIntersect(
                box,
                BoundingBox.transformed(node.shape.value.boundingBox(), node.worldTransform()),
            ),
    ) as ParametricBodyNode[];
}
