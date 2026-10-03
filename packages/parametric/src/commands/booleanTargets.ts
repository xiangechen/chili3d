// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type BoundingBox,
    type IDocument,
    Id,
    type TargetCandidate,
    type TargetSelection,
} from "@chili3d/core";
import type {
    BooleanOperation,
    ExtrudeFeatureData,
    LoftFeatureData,
    RevolveFeatureData,
    SweepFeatureData,
    ThickenFeatureData,
} from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";
import { findIntersectingBodies } from "./intersectingBody";

/**
 * A feature a boolean scope applies to: the form features, each carrying an `operation`. The
 * other feature kinds (fillet, chamfer, boolean) have no body to combine with, so a scope is
 * never asked for them.
 */
export type BooleanScopedFeature =
    | ExtrudeFeatureData
    | RevolveFeatureData
    | LoftFeatureData
    | SweepFeatureData
    | ThickenFeatureData;

/** Every body the feature could combine with, in tree order — what the panel lists. */
export function candidateBodies(document: IDocument): ParametricBodyNode[] {
    return document.modelManager.findNodes(
        (node) => node instanceof ParametricBodyNode,
    ) as ParametricBodyNode[];
}

export function targetCandidate(node: ParametricBodyNode): TargetCandidate {
    return { id: node.id, label: node.name };
}

/**
 * The bodies a commit or a preview combines with. Auto re-runs the detection against the
 * box it is given, so it always speaks for the tool as it stands now; an explicit selection
 * is kept as chosen — a body the user named is used even if the boxes no longer meet (that
 * is what naming it is for), and only the bodies that have since gone away drop out.
 *
 * Deduped and tree-ordered, so the same body cannot be appended to twice.
 */
export function resolveTargetBodies(
    document: IDocument,
    box: BoundingBox | undefined,
    selection: TargetSelection,
): ParametricBodyNode[] {
    if (selection.auto) return box === undefined ? [] : findIntersectingBodies(document, box);

    const chosen = new Set(selection.ids);
    return candidateBodies(document).filter((node) => chosen.has(node.id) && node.shape.isOk);
}

/**
 * What the detection writes back while it still owns the set: the bodies whose boxes meet
 * the tool's. Writes only when the set actually changed — the preview re-asks on every drag
 * tick and every path edge, and an unchanged set must not repaint the panel.
 */
export function syncAutoTargets(
    document: IDocument,
    box: BoundingBox,
    selection: TargetSelection,
    apply: (next: TargetSelection) => void,
): void {
    if (!selection.auto) return;

    const ids = findIntersectingBodies(document, box).map((node) => node.id);
    if (sameTargetIds(ids, selection.ids)) return;
    apply({ auto: true, ids });
}

/** Order-free set comparison: the detection's tree order is not the user's check order. */
export function sameTargetIds(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const set = new Set(left);
    return right.every((id) => set.has(id));
}

/** The feature as a body of its own — what a scope with nothing to combine with falls back to. */
export function standaloneBody(document: IDocument, feature: BooleanScopedFeature): void {
    document.modelManager.addNode(new ParametricBodyNode({ document, features: [feature] }));
}

/**
 * Commits the feature onto every target, or stands it up as its own body when there is
 * none (nothing intersected, or the user unchecked everything) — the operation is only
 * worth storing on a feature that has a body to combine with.
 *
 * Each target gets its own copy, with its own id: feature ids are only ever resolved inside
 * one body's chain, so sharing the data would work, but a distinct id keeps nothing from ever
 * aliasing across bodies.
 */
export function commitBooleanTargets(
    document: IDocument,
    feature: BooleanScopedFeature,
    operation: BooleanOperation,
    targets: readonly ParametricBodyNode[],
): void {
    if (targets.length === 0) {
        standaloneBody(document, feature);
        return;
    }

    for (const target of targets) {
        target.setFeaturesEmitShapeChanged([
            ...target.features,
            { ...feature, id: Id.generate(), operation },
        ]);
    }
}
