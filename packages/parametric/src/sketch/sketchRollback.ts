// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { featureHandler } from "../features";
import { ParametricBodyNode } from "../parametricBodyNode";
import type { SketchNode } from "./sketchNode";

/**
 * Fusion-style session rollback: while a sketch is edited, every body whose shape depends on it
 * is shown at the sketch's timeline position.
 *
 * - **Which state that is:** the state the body had when the sketch was created against it,
 *   with the CURRENT parameters of the features that already existed then.
 * - **Why:** the feature consuming the sketch and everything after it stays hidden for the
 *   session, so the sketch plane and the external references resolve against the same geometry
 *   they were captured from — a later fillet rounding a referenced edge cannot move or dangle
 *   it mid-session.
 * - **Runtime-only** (`ParametricBodyNode.setRollbackIndex`): nothing is serialized or
 *   transacted, and the full chain re-evaluates when the session ends.
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
 * The reverse of the propagation pass, for restoring the map on session exit: sources before
 * the bodies consuming them.
 *
 * - **Why the reverse is needed.** The map is in seed-then-propagation insertion order, which
 *   can place a consumer before a source it references (a consumer seeded on its own before the
 *   source propagated in). Restoring in that order re-evaluates the consumer against the
 *   source's session preview — a transient wrong (or failing) shape that only the source's
 *   later restore notification fixes up. Restoring sources first takes no detour at all.
 * - **Edges** come from the same place the rollback itself did — feature `nodeIds`, restricted
 *   to bodies inside the map (a referenced body that never rolled back already shows its full
 *   chain).
 * - **Ordering.** Kahn's algorithm scans in insertion order, so unrelated bodies keep their
 *   relative order. A dependency cycle — not constructible through the UI — cannot loop: its
 *   members append in insertion order, where the per-body restore guards absorb the mis-ordering.
 */
export function rollbackRestoreOrder(
    rollback: ReadonlyMap<ParametricBodyNode, number>,
): ParametricBodyNode[] {
    const bodies = [...rollback.keys()];
    const byId = new Map(bodies.map((body) => [body.id, body]));
    const pending = collectRestoreDependencies(bodies, byId);
    const order = drainReadyBodies(bodies, pending);
    // Cycle fallback (see the doc comment): whatever never emitted hangs off a
    // dependency cycle — insertion order, and the guards take care of it.
    for (const body of bodies) {
        if (pending.has(body)) order.push(body);
    }
    return order;
}

/** A body restores after every rolled-back source its features reference. */
function collectRestoreDependencies(
    bodies: ParametricBodyNode[],
    byId: ReadonlyMap<string, ParametricBodyNode>,
): Map<ParametricBodyNode, Set<ParametricBodyNode>> {
    const pending = new Map<ParametricBodyNode, Set<ParametricBodyNode>>();
    for (const body of bodies) {
        const deps = new Set<ParametricBodyNode>();
        for (const feature of body.features) {
            for (const id of featureHandler(feature.type)?.nodeIds(feature) ?? []) {
                // a self-reference (press-pull on an own face) carries no dependency
                if (id === body.id) continue;
                const source = byId.get(id);
                if (source !== undefined) deps.add(source);
            }
        }
        pending.set(body, deps);
    }
    return pending;
}

/** Kahn's algorithm: emits each body once every dependency of its has been emitted. */
function drainReadyBodies(
    bodies: ParametricBodyNode[],
    pending: Map<ParametricBodyNode, Set<ParametricBodyNode>>,
): ParametricBodyNode[] {
    const order: ParametricBodyNode[] = [];
    let progressed = true;
    while (pending.size > 0 && progressed) {
        progressed = false;
        for (const body of bodies) {
            const deps = pending.get(body);
            if (deps === undefined) continue; // already in `order`
            for (const dep of deps) {
                if (!pending.has(dep)) deps.delete(dep); // restores earlier in `order`
            }
            if (deps.size > 0) continue;
            pending.delete(body);
            order.push(body);
            progressed = true;
        }
    }
    return order;
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
