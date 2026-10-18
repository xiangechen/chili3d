// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { type INode, NodeUtils } from "./node";

/**
 * The shared marker of a placement node that reads another node's geometry instead of
 * owning it. `BodyInstanceNode` covers `ShapeNode` sources and `MeshInstanceNode`
 * covers `MeshNode` sources; commands that must treat either as an instance (copy,
 * array, group, delete, detach) ask this instead of a concrete class.
 *
 * `isInstance` is a getter rather than a serialized flag: it is a type fact, and the
 * stored field that matters (`sourceId`) is already serialized by each class.
 */
export interface IInstanceNode extends INode {
    readonly isInstance: true;
    readonly sourceId: string;
    /** The node this placement reads; undefined when it is gone. */
    readonly source: INode | undefined;
}

export function isInstanceNode(node: INode | undefined): node is IInstanceNode {
    return (
        node !== undefined &&
        (node as { isInstance?: unknown }).isInstance === true &&
        typeof (node as { sourceId?: unknown }).sourceId === "string"
    );
}

/**
 * Points every instance of `oldId` at `newId`. A destructive command that replaces a
 * source node with a new one (a fillet on a primitive, a shell, a repair) calls this in
 * the same transaction, so the instances keep following the definition instead of
 * dangling. Returns how many references moved.
 *
 * One-to-many edits (split, break) have no single successor and deliberately keep the
 * old id; those instances surface their missing-source warning.
 */
export function retargetInstanceSources(document: IDocument, oldId: string, newId: string): number {
    if (oldId === newId) return 0;
    let count = 0;
    for (const node of document.modelManager.findNodesDeep(isInstanceNode)) {
        if (node.sourceId !== oldId) continue;
        (node as { sourceId: string }).sourceId = newId;
        count++;
    }
    return count;
}

/**
 * Which of the nodes about to be removed are still read by an instance that survives.
 *
 * A one-to-many or many-to-one command (`boolean`, `trim`, `sew`, `loft`) has no single
 * successor to hand to `retargetInstanceSources`, so it asks this first and refuses the
 * removal instead of leaving the instances dangling. Each node's subtree is part of the
 * removal too (a consumed boolean tool goes away with its body), so it is expanded here.
 */
export function instanceSourcesInUse(document: IDocument, removing: readonly INode[]): Set<string> {
    const removed = new Set<string>();
    for (const node of removing) {
        removed.add(node.id);
        if (!NodeUtils.isLinkedListNode(node)) continue;
        for (const child of NodeUtils.children(node)) removed.add(child.id);
    }

    const used = new Set<string>();
    for (const node of document.modelManager.findNodesDeep(isInstanceNode)) {
        if (removed.has(node.id)) continue;
        if (removed.has(node.sourceId)) used.add(node.sourceId);
    }
    return used;
}
