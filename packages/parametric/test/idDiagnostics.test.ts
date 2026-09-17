// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { reportSilentIdLoss } from "../src/features/idDiagnostics";

function nodeWith(edgeId: string | undefined, faceId: string | undefined) {
    return {
        id: "b1",
        edgeIdAt: (index: number) => (index === 0 ? edgeId : undefined),
        edgeIndexById: (_id: string) => undefined,
        edgeIndexesOfId: (_id: string) => [] as number[],
        faceIdAt: (index: number) => (index === 0 ? faceId : undefined),
        faceIndexById: (_id: string) => undefined,
        faceIndexesOfId: (_id: string) => [] as number[],
    };
}

describe("reportSilentIdLoss", () => {
    test("warns when a tracked body loses an id", () => {
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        try {
            reportSilentIdLoss(nodeWith("e1:0", undefined), "edge", "a picked edge has no tracked id");
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain("a picked edge has no tracked id");
            expect(String(warn.mock.calls[0][0])).toContain("b1");
        } finally {
            warn.mockRestore();
        }
    });

    test("stays silent on an untracked body — the designed degradation", () => {
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        try {
            reportSilentIdLoss(nodeWith(undefined, undefined), "edge", "x");
            reportSilentIdLoss(nodeWith(undefined, undefined), "face", "x");
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});
