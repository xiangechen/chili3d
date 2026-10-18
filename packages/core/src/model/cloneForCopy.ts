// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "../math";
import { BodyInstanceNode } from "./bodyInstanceNode";
import { MeshInstanceNode } from "./meshInstanceNode";
import { MeshNode } from "./meshNode";
import { ShapeNode } from "./shapeNode";
import { VisualNode } from "./visualNode";

/** The structural slice a plain-object test double or pre-hook plugin can offer. */
interface CloneableLike {
    clone: () => VisualNode;
    cloneForCopy?: (transform: Matrix4) => VisualNode;
    cloneTransformed?: (transform: Matrix4) => VisualNode;
    transform?: Matrix4;
}

/**
 * The copy a copy-and-place operation (Move with clone, Array, Copy) makes.
 *
 * A node that overrides `cloneForCopy` decides for itself, whatever its
 * `copiesAsInstance` answer — an override is an explicit choice (the parametric body
 * does both). Otherwise a node that advertises `copiesAsInstance` is placed as an
 * instance of itself: `ShapeNode` sources get a `BodyInstanceNode`, `MeshNode` sources
 * a `MeshInstanceNode`. A world-space input (a sketch) is cloned in place — a placement
 * would be a ghost transform on it.
 *
 * Plain-object doubles and pre-hook plugins have no `VisualNode` prototype, so they are
 * served by the same fallback chain here instead of in every caller.
 */
export function cloneForCopyNode(node: VisualNode, transform: Matrix4): VisualNode {
    const raw = node as unknown as CloneableLike;
    if (!(raw instanceof VisualNode)) return cloneDuckCopy(raw, transform);

    if (node.cloneForCopy !== VisualNode.prototype.cloneForCopy) return node.cloneForCopy(transform);
    if (!node.copiesAsInstance) {
        return node.transformMode === "none" ? node.clone() : node.cloneTransformed(transform);
    }
    if (node instanceof MeshNode) return MeshInstanceNode.fromSource(node, transform);
    if (node instanceof ShapeNode) return BodyInstanceNode.fromSource(node, transform);
    return node.cloneTransformed(transform);
}

function cloneDuckCopy(raw: CloneableLike, transform: Matrix4): VisualNode {
    if (raw.cloneForCopy !== undefined) return raw.cloneForCopy.call(raw, transform);
    if (raw.cloneTransformed !== undefined) return raw.cloneTransformed.call(raw, transform);

    const clone = raw.clone();
    const current = (clone as { transform?: Matrix4 }).transform ?? Matrix4.identity();
    clone.transform = current.multiply(transform);
    return clone;
}
