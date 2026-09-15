// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { featureHandler } from "../features";
import { ParametricBodyNode } from "../parametricBodyNode";
import type { SketchNode } from "./sketchNode";

/**
 * Fusion-style session rollback: while a sketch is edited, every body whose shape
 * depends on the sketch is shown at the sketch's timeline position — the state the
 * body had when the sketch was created against it, with the current parameters of
 * the features that already existed then. The feature consuming the sketch and
 * everything after it stays hidden for the session, so the sketch plane and the
 * external references resolve against the same geometry they were captured from
 * (a later fillet rounding a referenced edge cannot move or dangle it mid-session).
 * The rollback is runtime-only (`ParametricBodyNode.setRollbackIndex`): nothing is
 * serialized or transacted, and the full chain re-evaluates when the session ends.
 */

/**
 * The rollback index per body — features `[0, index)` stay evaluated. Computed in
 * two phases (seed, then propagate) so the result is transitively closed: a
 * rolled-back body never feeds an unrolled consumer, which would mix states that
 * never coexisted on the timeline.
 */
export function computeSketchRollback(
    document: IDocument,
    sketch: SketchNode,
): Map<ParametricBodyNode, number> {
    const bodies = document.modelManager.findNodes(
        (node) => node instanceof ParametricBodyNode,
    ) as ParametricBodyNode[];
    const indices = seedRollbackIndices(bodies, sketch);
    propagateRollback(bodies, sketch.id, indices);
    return indices;
}

/**
 * Phase 1: seed each body with its own rollback point — the first feature
 * referencing the sketch, capped by the timeline anchor recorded at capture time
 * (`SketchData.refPositions`). An anchor at the feature count hides nothing
 * (every feature already existed at capture time), so it is not seeded.
 */
function seedRollbackIndices(
    bodies: ParametricBodyNode[],
    sketch: SketchNode,
): Map<ParametricBodyNode, number> {
    const positions = sketch.data.refPositions ?? {};
    const indices = new Map<ParametricBodyNode, number>();
    for (const body of bodies) {
        const referencing = firstReferencingFeatureIndex(body, new Set([sketch.id]));
        const anchor = positions[body.id];
        let index = referencing;
        if (anchor !== undefined && anchor < body.features.length) {
            index = index === undefined ? anchor : Math.min(index, anchor);
        }
        if (index !== undefined) indices.set(body, index);
    }
    return indices;
}

/**
 * Phase 2: propagate to a fixpoint — a rolled-back body is itself a timeline cut,
 * so a body whose feature references it (a boolean's tool carries the dependency
 * across bodies) rolls back to that feature too. Indices only ever decrease and
 * the body set only grows, so the loop terminates.
 */
function propagateRollback(
    bodies: ParametricBodyNode[],
    sketchId: string,
    indices: Map<ParametricBodyNode, number>,
): void {
    let changed = true;
    while (changed) {
        changed = false;
        const downstream = new Set<string>([sketchId]);
        for (const body of indices.keys()) downstream.add(body.id);
        for (const body of bodies) {
            const index = firstReferencingFeatureIndex(body, downstream);
            if (index === undefined) continue;
            if ((indices.get(body) ?? Infinity) > index) {
                indices.set(body, index);
                changed = true;
            }
        }
    }
}

/**
 * First feature index whose referenced nodes include a downstream node, or
 * undefined. A feature referencing the host body itself (a press-pull extrude
 * sourced on one of its own faces) does not make the feature downstream — the
 * self-reference carries no external dependency.
 */
function firstReferencingFeatureIndex(
    body: ParametricBodyNode,
    downstream: ReadonlySet<string>,
): number | undefined {
    const features = body.features;
    for (let index = 0; index < features.length; index++) {
        const ids = featureHandler(features[index].type)?.nodeIds(features[index]) ?? [];
        if (ids.some((id) => id !== body.id && downstream.has(id))) return index;
    }
    return undefined;
}
