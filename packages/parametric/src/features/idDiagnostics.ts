// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IBodyTrackingNode } from "./bodyTracking";

/**
 * Every identity loss this build reported, in order — the sink the test guard drains
 * (`packages/parametric/test/setup.ts`). Kept beside the reporters rather than inferred from
 * the console so the guard needs no `console` patching (which would break any test asserting
 * the console wiring, e.g. core's `logger.test.ts`).
 */
export const identityLosses: string[] = [];

/**
 * Reports a lost stable id: warns on the console AND records it for the test guard.
 *
 * A loss means a reference that had to fall back to geometric matching because the sub-shape
 * it named carries no stable id — a bug in the tracking chain, not a designed degradation
 * (an untracked chain reports nothing at all).
 */
export function reportIdentityLoss(message: string): void {
    identityLosses.push(message);
    console.warn(message);
}

/**
 * Makes silent stable-id losses loud. A reference captured from a TRACKED body
 * (its current shape carries tracked sub-shape ids) must always resolve an id —
 * a miss is a bug in the tracking chain (e.g. a kernel matching failure at
 * capture time, like the isEqual/isSame boundary-edge loss), and silently
 * degrading the ref to fingerprint-only matching hides it until a later edit
 * strands the ref between look-alike candidates. So the miss is reported on the
 * console instead. An UNTRACKED body (a chain link that could not track leaves
 * the id arrays undefined) is the designed degradation and stays silent.
 *
 * "Tracked" has to be asked of the node (`hasTrackedIds`), not inferred from index 0:
 * an individual entry is legitimately unnamed in a tracked body — a 360° revolve's
 * seam edge carries no id — so the old `idAt(0) !== undefined` proxy both fired on
 * designed states and swallowed real losses whose index 0 happened to be unnamed.
 */
export function reportSilentIdLoss(
    node: { readonly id: string } & IBodyTrackingNode,
    kind: "edge" | "face",
    what: string,
): void {
    if (!node.hasTrackedIds(kind)) return;
    const guidance = "the reference falls back to geometric matching. Please report this scenario.";
    reportIdentityLoss(`[chili3d] stable-id loss: ${what} (node ${node.id}) — ${guidance}`);
}
