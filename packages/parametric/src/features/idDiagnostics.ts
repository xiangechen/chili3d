// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IBodyTrackingNode } from "./bodyTracking";

/**
 * Makes silent stable-id losses loud. A reference captured from a TRACKED body
 * (its current shape carries tracked sub-shape ids) must always resolve an id —
 * a miss is a bug in the tracking chain (e.g. a kernel matching failure at
 * capture time, like the isEqual/isSame boundary-edge loss), and silently
 * degrading the ref to fingerprint-only matching hides it until a later edit
 * strands the ref between look-alike candidates. So the miss is reported on the
 * console instead. An UNTRACKED body (a chain link that could not track leaves
 * the id arrays undefined) is the designed degradation and stays silent.
 */
export function reportSilentIdLoss(
    node: { readonly id: string } & IBodyTrackingNode,
    kind: "edge" | "face",
    what: string,
): void {
    const tracked = (kind === "edge" ? node.edgeIdAt(0) : node.faceIdAt(0)) !== undefined;
    if (!tracked) return;
    const guidance = "the reference falls back to geometric matching. Please report this scenario.";
    console.warn(`[chili3d] stable-id loss: ${what} (node ${node.id}) — ${guidance}`);
}
