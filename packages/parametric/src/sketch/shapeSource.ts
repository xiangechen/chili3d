// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type INodeVisual, type IShape, Matrix4, ShapeNode } from "@chili3d/core";

/** A referenced node with its current shape and world transform. */
export interface ShapeSource {
    node: ShapeNode;
    shape: IShape;
    transform: Matrix4;
}

/**
 * The single node-id → (shape, world transform) resolution shared by the external
 * reference and plane reference re-matchers — keep their strategies from forking.
 * Undefined when the node is gone or has no valid shape; the transform falls back
 * to identity when the node has no visual.
 */
export function resolveShapeSource(document: IDocument, nodeId: string): ShapeSource | undefined {
    const node = document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return undefined;
    const visual = document.visual.context.getVisual(node) as INodeVisual | undefined;
    return {
        node,
        shape: node.shape.unchecked()!,
        transform: visual?.worldTransform() ?? Matrix4.identity(),
    };
}
