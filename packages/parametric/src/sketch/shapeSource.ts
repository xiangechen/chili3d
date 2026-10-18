// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IShape, Matrix4, ShapeNode } from "@chili3d/core";

/** A referenced node with its current shape and world transform. */
export interface ShapeSource {
    node: ShapeNode;
    shape: IShape;
    transform: Matrix4;
}

/**
 * `node` with a known-valid `shape` and its world transform. `VisualNode.worldTransform`
 * already resolves through the visual when one exists and falls back to the node's own
 * placement when it does not — so refs follow a node moved in a mocked/headless document
 * exactly as they do in the app.
 */
export function shapeSourceOf(_document: IDocument, node: ShapeNode, shape: IShape): ShapeSource {
    return { node, shape, transform: node.worldTransform() };
}
