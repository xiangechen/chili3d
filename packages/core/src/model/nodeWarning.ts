// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";

/**
 * Implemented by nodes carrying a non-fatal, user-visible warning state — e.g. a
 * sketch whose external references lost their source. The model tree badges the
 * node's row while `warningCount` is non-zero (SolidWorks FeatureManager-style),
 * without the node knowing anything about the tree.
 */
export interface INodeWarning {
    /** Number of active warnings; the badge hides at 0 and puts the count in its tooltip. */
    readonly warningCount: number;
    /** Badge tooltip key — `{0}` is replaced with `warningCount`. */
    readonly warningTooltip: I18nKeys;
}

export function isNodeWarning(node: unknown): node is INodeWarning {
    const candidate = node as INodeWarning | undefined;
    return typeof candidate?.warningCount === "number" && typeof candidate?.warningTooltip === "string";
}
