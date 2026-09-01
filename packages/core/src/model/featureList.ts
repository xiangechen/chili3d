// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";
import type { INode } from "./node";

/** A single editable parameter of a feature, rendered by the feature list panel. */
export interface FeatureParameter {
    readonly key: string;
    readonly display: I18nKeys;
    /**
     * Literal number or an expression string (e.g. `width * 2`) resolved at rebuild;
     * booleans render as a checkbox (e.g. a boolean feature's consume-tools toggle).
     */
    readonly value: number | string | boolean;
}

/** One row of a parametric body's ordered feature list. */
export interface FeatureItem {
    readonly id: string;
    readonly display: I18nKeys;
    /** User-assigned name; the panel shows it instead of `display` when set. */
    readonly name?: string;
    /** Iconfont key shown before the display name (e.g. "icon-fillet"). */
    readonly icon?: string;
    /** Suppressed features are skipped on rebuild and shown dimmed. */
    readonly suppressed?: boolean;
    /** Set when this feature failed to rebuild — the panel highlights the row. */
    readonly error?: string;
    /** Set when the feature's shape references (e.g. fillet edges) can be re-picked. */
    readonly reselectable?: boolean;
    readonly parameters: readonly FeatureParameter[];
}

/**
 * Implemented by nodes that own an ordered, editable feature list (e.g. parametric
 * bodies). The property panel renders this contract without knowing the concrete
 * node or feature types.
 */
export interface IFeatureListNode {
    featureItems(): readonly FeatureItem[];
    setFeatureParameter(featureId: string, key: string, value: number | string | boolean): void;
    setFeatureSuppressed(featureId: string, suppressed: boolean): void;
    moveFeature(featureId: string, offset: -1 | 1): void;
    /** Moves a feature to an absolute index in one step; panels fall back to `moveFeature`. */
    moveFeatureTo?(featureId: string, index: number): void;
    /** Assigns a custom display name; an empty name clears it. */
    renameFeature?(featureId: string, name: string): void;
    removeFeature(featureId: string): void;
    /** Re-picks the shapes a feature references (e.g. the edges of a fillet). */
    reselectShapes?(featureId: string): void;
    /** External nodes referenced by features (e.g. sketches); shown as reference rows in the tree. */
    referencedNodes?(): INode[];
}

export function isFeatureListNode(node: unknown): node is IFeatureListNode {
    const candidate = node as IFeatureListNode;
    return (
        typeof candidate?.featureItems === "function" &&
        typeof candidate?.setFeatureParameter === "function" &&
        typeof candidate?.removeFeature === "function"
    );
}
