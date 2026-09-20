// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { reportSilentIdLoss } from "../src/features/idDiagnostics";
import { claimIdentityLosses } from "./identityLoss";

/**
 * A tracking node mock. `tracked` is the body-level fact `reportSilentIdLoss` must ask about;
 * `idsAt` is what individual entries look like — undefined for an entry the chain deliberately
 * left unnamed, which is orthogonal to whether the body tracks at all.
 */
function nodeWith(tracked: boolean, idAt0: string | undefined) {
    return {
        id: "b1",
        hasTrackedIds: (_kind: "edge" | "face") => tracked,
        edgeIdAt: (index: number) => (index === 0 ? idAt0 : undefined),
        edgeIndexById: (_id: string) => undefined,
        edgeIndexesOfId: (_id: string) => [] as number[],
        faceIdAt: (index: number) => (index === 0 ? idAt0 : undefined),
        faceIndexById: (_id: string) => undefined,
        faceIndexesOfId: (_id: string) => [] as number[],
    };
}

describe("reportSilentIdLoss", () => {
    test("reports when a tracked body loses an id", () => {
        reportSilentIdLoss(nodeWith(true, "e1:0"), "edge", "a picked edge has no tracked id");

        const reported = claimIdentityLosses();
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain("a picked edge has no tracked id");
        expect(reported[0]).toContain("b1");
    });

    test("reports on a tracked body even when its index-0 entry is unnamed", () => {
        // The regression the body-level question fixes: index 0 carries no id
        // (`attributeSweepEdges` leaves some sub-shapes unnamed by design), and the old
        // `idAt(0) !== undefined` proxy read that as "untracked" — swallowing real losses.
        reportSilentIdLoss(nodeWith(true, undefined), "edge", "a re-picked edge has no tracked id");

        expect(claimIdentityLosses()).toHaveLength(1);
    });

    test("stays silent on an untracked body — the designed degradation", () => {
        reportSilentIdLoss(nodeWith(false, undefined), "edge", "x");
        reportSilentIdLoss(nodeWith(false, undefined), "face", "x");

        expect(claimIdentityLosses()).toEqual([]);
    });

    test("stays silent on an untracked body even when an entry happens to carry an id", () => {
        reportSilentIdLoss(nodeWith(false, "e1:0"), "edge", "x");

        expect(claimIdentityLosses()).toEqual([]);
    });
});
