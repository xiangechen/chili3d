// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";

/** A single editable parameter of a feature, rendered by the feature list panel. */
export interface FeatureParameter {
    readonly key: string;
    readonly display: I18nKeys;
    /** Literal number, or an expression string (e.g. `width * 2`) resolved at rebuild. */
    readonly value: number | string;
}

/** One row of a parametric body's ordered feature list. */
export interface FeatureItem {
    readonly id: string;
    readonly display: I18nKeys;
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
    setFeatureParameter(featureId: string, key: string, value: number | string): void;
    setFeatureSuppressed(featureId: string, suppressed: boolean): void;
    moveFeature(featureId: string, offset: -1 | 1): void;
    removeFeature(featureId: string): void;
    /** Re-picks the shapes a feature references (e.g. the edges of a fillet). */
    reselectShapes?(featureId: string): void;
}

export function isFeatureListNode(node: unknown): node is IFeatureListNode {
    const candidate = node as IFeatureListNode;
    return (
        typeof candidate?.featureItems === "function" &&
        typeof candidate?.setFeatureParameter === "function" &&
        typeof candidate?.removeFeature === "function"
    );
}
