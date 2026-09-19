// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Optional leading icon for a node's row in the model tree, as an iconfont key.
 *
 * Deliberately not part of `INode`: a row without it renders exactly as rows always
 * have, so nodes opt in one at a time and plugins can add their own without the tree
 * knowing the type. `nodeWarning.ts` is the same shape, for the warning badge.
 */
export interface INodeIcon {
    readonly icon: string;
}

export function isNodeIcon(node: unknown): node is INodeIcon {
    return typeof (node as INodeIcon | undefined)?.icon === "string";
}
