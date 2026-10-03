// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "../i18n";
import type { UnitSpec } from "../parameters/unitSpec";
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
    /** The unit the slot expects — the panel hints it, the rebuild enforces it. */
    readonly unit?: UnitSpec;
    /**
     * The parameters this one is only meaningful beside, as `key`s of the SAME feature: the row
     * is hidden unless every named parameter currently holds the listed value. A thicken's
     * second thickness beside its midplane toggle, say — the value stays on the feature (the
     * handler still returns it, and it survives as the user typed it), only its row goes.
     *
     * Hidden is not removed: `FeatureItem.parameters` still carries the entry, so the panel's
     * lookups by key keep working and nothing has to re-derive the list.
     */
    readonly visibleWhen?: readonly {
        readonly key: string;
        readonly value: number | string | boolean;
    }[];
    /**
     * Present when the parameter holds one of a fixed set — the row then renders a dropdown
     * instead of a text box, so the value cannot be typed wrong. An enum kept as a bare string
     * would otherwise be free text, and the panel has no way to reject a token the rebuild will
     * refuse (see `shell`'s join type and `loft`'s continuity).
     */
    readonly choices?: readonly FeatureParameterChoice[];
}

/** One entry of a `choices` parameter's dropdown: the value stored on the feature, and its label. */
export interface FeatureParameterChoice {
    readonly value: number | string | boolean;
    /**
     * The row's label. Absent means the value is its own label, shown uppercased — for a token
     * that reads the same in every language (`g1` as `G1`), where a translation would be an
     * invented wording rather than a translation.
     */
    readonly display?: I18nKeys;
}

/**
 * A node a feature holds and the panel shows as a link row (e.g. the sketch an
 * extrude consumes). The node keeps its own row in the tree; this is a second
 * entry point, so the panel shows *which* feature holds it.
 */
export interface FeatureReference {
    /** Identifies the reference slot on the feature (e.g. `sketchId`). */
    readonly key: string;
    readonly display: I18nKeys;
    readonly node: INode;
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
    /** Set when this feature failed to rebuild — the panel highlights the row and keeps it expanded. */
    readonly error?: string;
    /**
     * Set for a softer, non-fatal condition (e.g. a sketch's dangling external
     * reference): the panel tints the row and shows the text when expanded, but
     * does not force expansion like an error does.
     */
    readonly warning?: string;
    /** Set when the feature's shape references (e.g. fillet edges) can be re-picked. */
    readonly reselectable?: boolean;
    /** Nodes this feature holds (e.g. its sketch), shown as link rows above the parameters. */
    readonly references?: readonly FeatureReference[];
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
    /**
     * Opens the node one of the feature's references points at (e.g. entering the
     * sketch an extrude consumes). `key` is the reference's own key, as reported in
     * `FeatureItem.references`.
     */
    activateReference?(featureId: string, key: string): void;
}

export function isFeatureListNode(node: unknown): node is IFeatureListNode {
    const candidate = node as IFeatureListNode;
    return (
        typeof candidate?.featureItems === "function" &&
        typeof candidate?.setFeatureParameter === "function" &&
        typeof candidate?.removeFeature === "function"
    );
}
