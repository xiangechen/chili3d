// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The stable-id / tracking surface `ParametricBodyNode` exposes so feature code can
 * map kernel sub-shape indexes back to stable ids without importing the node class
 * itself — importing it would close an import cycle (feature modules are imported by
 * the body node).
 */
export interface IBodyTrackingNode {
    faceIdAt(index: number): string | undefined;
    faceIndexById(id: string): number | undefined;
    edgeIdAt(index: number): string | undefined;
    edgeIndexById(id: string): number | undefined;
}

/** Structural check — `ParametricBodyNode` is the only node exposing `faceIdAt`. */
export function isBodyTrackingNode<T>(node: T): node is T & IBodyTrackingNode {
    if (node == null) return false;
    return typeof (node as unknown as Partial<IBodyTrackingNode>).faceIdAt === "function";
}
