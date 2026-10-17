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
     * A `value` may list several values; the row then shows when the parameter holds ANY of
     * them (a chamfer's flip toggle beside both asymmetric modes).
     *
     * Hidden is not removed: `FeatureItem.parameters` still carries the entry, so the panel's
     * lookups by key keep working and nothing has to re-derive the list.
     */
    readonly visibleWhen?: readonly {
        readonly key: string;
        /** The controlling value — or several: the row shows when the parameter holds ANY of them. */
        readonly value: number | string | boolean | readonly (number | string | boolean)[];
    }[];
    /**
     * Present when the parameter holds one of a fixed set — the row then renders a dropdown
     * instead of a text box, so the value cannot be typed wrong. An enum kept as a bare string
     * would otherwise be free text, and the panel has no way to reject a token the rebuild will
     * refuse (see `shell`'s join type and `loft`'s continuity).
     */
    readonly choices?: readonly FeatureParameterChoice[];
    /**
     * Present to share one row with the parameter's neighbours: the ADJACENT parameters
     * carrying the same `group.id` render as a single row — labelled by the group's `display`,
     * each member keeping its own control beside a small label with the member's `display`
     * (an origin's x/y/z under one "Origin" row). Only adjacent members merge; the same id
     * appearing again further down starts a second row.
     *
     * Grouping is display-only. `setFeatureParameter` still writes each member back by its
     * own `key`, and `visibleWhen` keeps its per-member semantics — a hidden member simply
     * drops out of the row (hidden is not removed), and a group whose members are all hidden
     * shows no row at all.
     */
    readonly group?: FeatureParameterGroup;
}

/**
 * A display grouping for adjacent parameters — see `FeatureParameter.group`. Purely a
 * panel concern: the feature stores and resolves each member by its own `key`, so the
 * same group declared on every member (id and display alike) is what keeps the row
 * coherent whichever members happen to be visible.
 */
export interface FeatureParameterGroup {
    /** Groups members: adjacent parameters sharing an id render as one row. */
    readonly id: string;
    /** The shared row's label; the members' own `display`s demote to the in-row labels. */
    readonly display: I18nKeys;
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

/**
 * A picked input a feature no longer resolves, as the feature row shows it. `key` and
 * `refIndex` name the slot the pick came out of — which field, and which position within
 * the feature's own list for that field — so the row can say which pick went and a reader
 * can find it in the stored feature. They identify the slot; the re-pick itself is the
 * feature's own whole-list action (`IFeatureListNode.reselectShapes`).
 */
export interface FeatureMissingInput {
    /** The feature field the input belongs to, e.g. `profiles` or `toolIds`. */
    readonly key: string;
    /** Position within that field's list, as stored on the feature (0-based). */
    readonly refIndex: number;
    /** The row's wording, already translated. */
    readonly label: string;
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
    /**
     * The document variable driving this feature's suppression (`FeatureBase.suppressBy`),
     * when one is configured — the panel shows the source so a row suppressed by a variable
     * is distinguishable from a manually suppressed one.
     */
    readonly suppressVariable?: string;
    /** The `invert` flag of the configured variable suppression (see `suppressVariable`). */
    readonly suppressVariableInvert?: boolean;
    /**
     * True when the variable suppression was ACTIVE on the last rebuild (the variable
     * resolved to a suppressing value). Distinct from `suppressed` (manual); both can
     * hold at once.
     */
    readonly suppressedByVariable?: boolean;
    /** Set when this feature failed to rebuild — the panel highlights the row and keeps it expanded. */
    readonly error?: string;
    /**
     * Set for a softer, non-fatal condition (e.g. a sketch's dangling external
     * reference): the panel tints the row and shows the text when expanded, but
     * does not force expansion like an error does.
     */
    readonly warning?: string;
    /**
     * Picked inputs the feature could not re-resolve and built without. The row shows one
     * placeholder line per entry in place of the pick, so the user can see WHICH input went
     * rather than finding the feature quietly operating on fewer inputs. On a `reselectable`
     * feature the line is also the door to the re-pick.
     */
    readonly missingInputs?: readonly FeatureMissingInput[];
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
    /**
     * Sets (or, with undefined, clears) the variable-driven suppression of a feature —
     * the feature is skipped whenever the named document variable resolves to 0 (`invert`
     * flips the test). Panels call it inside a transaction like any other list edit.
     */
    setFeatureSuppressVariable?(
        featureId: string,
        value: { variable: string; invert?: boolean } | undefined,
    ): void;
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
    /**
     * The persisted rollback-bar position: features at and after this list index are
     * excluded from every rebuild (and dimmed in the panel) until the bar moves on.
     * Undefined — the default — builds the full list. Unlike a session rollback
     * preview this is recorded with the document, so it survives save/load and undo.
     */
    readonly rollbackBarIndex?: number;
    /**
     * Moves the persisted rollback bar to `index` (undefined or past the end clears
     * it) and re-evaluates. Panels call it inside a transaction so the move is one
     * undo step, like every other feature-list edit.
     */
    setRollbackBar?(index: number | undefined): void;
    /**
     * Ids of the downstream features whose stored shape references name geometry that
     * `featureId` contributes to the chain — the panel's cascade hint before a
     * suppression strands them. Undefined when the node cannot tell (id tracking
     * unavailable or the feature unevaluated); an empty array means nothing downstream
     * references it.
     */
    featureDependents?(featureId: string): string[] | undefined;
    /**
     * Ids of the UPSTREAM features whose contributed geometry `featureId`'s stored
     * references name — the inverse of `featureDependents`, for the panel's
     * "depends on" line. Same availability contract: undefined when the node cannot
     * tell, an empty array when nothing upstream is referenced.
     */
    featureDependencies?(featureId: string): string[] | undefined;
}

export function isFeatureListNode(node: unknown): node is IFeatureListNode {
    const candidate = node as IFeatureListNode;
    return (
        typeof candidate?.featureItems === "function" &&
        typeof candidate?.setFeatureParameter === "function" &&
        typeof candidate?.removeFeature === "function"
    );
}
