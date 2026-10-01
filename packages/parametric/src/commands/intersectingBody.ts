// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IDocument } from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";

/**
 * The join/cut/intersect target, auto-detected: the first parametric body whose bounding
 * box intersects the tool's (bounds only — a real interference check would cost a boolean
 * per candidate; overlapping boxes with disjoint geometry just produce a no-op boolean).
 * "New" bypasses this and stands the feature up as its own body.
 *
 * `box` is the tool's box in WORLD coordinates (callers build it from world-space picks),
 * and a body's shape lives in its own local space, so its box is transformed before the
 * comparison — moving or rotating a body must not change what it can be joined into.
 */
export function findIntersectingBody(document: IDocument, box: BoundingBox): ParametricBodyNode | undefined {
    return document.modelManager.findNode(
        (node) =>
            node instanceof ParametricBodyNode &&
            node.shape.isOk &&
            BoundingBox.isIntersect(
                box,
                BoundingBox.transformed(node.shape.value.boundingBox(), node.worldTransform()),
            ),
    ) as ParametricBodyNode | undefined;
}
