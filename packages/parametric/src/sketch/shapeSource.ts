// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type INodeVisual, type IShape, Matrix4, type ShapeNode } from "@chili3d/core";

/** A referenced node with its current shape and world transform. */
export interface ShapeSource {
    node: ShapeNode;
    shape: IShape;
    transform: Matrix4;
}

/** `node` with a known-valid `shape` and its world transform (identity when it has no visual). */
export function shapeSourceOf(document: IDocument, node: ShapeNode, shape: IShape): ShapeSource {
    const visual = document.visual.context.getVisual(node) as INodeVisual | undefined;
    return { node, shape, transform: visual?.worldTransform() ?? Matrix4.identity() };
}
