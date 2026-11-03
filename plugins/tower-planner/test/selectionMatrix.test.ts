// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MCT88, TOWER_CRANES } from "../src/catalogue";
import { findCranesPassingAllPicks, type Pick } from "../src/pickEngine";
import { loadSampleSitePicks } from "../src/sampleSite";
import { buildSelectionMatrix, selectionReason } from "../src/selectionMatrix";

// Hand-worked for mast (44, 17) with both cranes at their 30 m catalogue default jib:
//   P1: supply hypot(18, 11.5) = 21.36 m; drop hypot(18, 22) = 28.43 m -> drop governs.
//       MCT 88: 81 / 28.43 = 2.85 t -> 2.0 / 2.85 = 70.2 % PASS.
//       MCT 85 F5: 28.43 m falls between the 27 m and 29 m chart points -> 2.50 t -> 80.0 % PASS.
//   P2: supply hypot(39, 4) = 39.20 m > 30 m jib -> OUT_OF_RANGE on both cranes.
//   P3: supply hypot(38, 28) = 47.20 m > 30 m jib -> OUT_OF_RANGE on both cranes.
//   P4: supply hypot(11, 9) = 14.21 m; drop hypot(6, 8) = 10.00 m -> supply governs.
//       Both cranes: 5.00 t at 14.21 m -> 4.2 / 5.00 = 84.0 % PASS.
//   P5: drop hypot(24, 49) = 54.56 m > 30 m jib -> OUT_OF_RANGE on both cranes.
// Each crane therefore passes 2 of 5 and no catalogue crane passes every pick.
function samplePicks(): Pick[] {
    const result = loadSampleSitePicks();
    if (!result.ok) throw new Error("Expected the bundled sample site to be valid.");
    return result.picks;
}

describe("buildSelectionMatrix", () => {
    test("evaluates every catalogue crane against all five sample-site picks", () => {
        const matrix = buildSelectionMatrix(TOWER_CRANES, samplePicks(), {
            mast: { x: 44, y: 17 },
        });

        expect(matrix.rows).toHaveLength(2);
        expect(matrix.rows.map((row) => row.craneId)).toEqual(["potain-mct-88", "potain-mct-85-f5"]);
        expect(matrix.rows.map((row) => row.jibM)).toEqual([30, 30]);
        expect(matrix.rows.every((row) => row.picks.length === 5)).toBe(true);
        expect(matrix.pickCount).toBe(5);
        expect(matrix.craneCount).toBe(2);
    });

    test("reports hand-worked status, capacity and utilisation for every cell", () => {
        const matrix = buildSelectionMatrix(TOWER_CRANES, samplePicks(), {
            mast: { x: 44, y: 17 },
        });
        const [mct88, mct85] = matrix.rows;

        expect(mct88.picks.map((pick) => pick.status)).toEqual([
            "PASS",
            "OUT_OF_RANGE",
            "OUT_OF_RANGE",
            "PASS",
            "OUT_OF_RANGE",
        ]);
        expect(mct88.picks[0].radiusM).toBeCloseTo(28.4253, 3);
        expect(mct88.picks[0].governing).toBe("drop");
        expect(mct88.picks[0].capacityT).toBeCloseTo(2.8496, 3);
        expect(mct88.picks[0].utilisationPct).toBeCloseTo(70.186, 3);
        expect(mct88.picks[3].radiusM).toBeCloseTo(14.2127, 3);
        expect(mct88.picks[3].governing).toBe("supply");
        expect(mct88.picks[3].capacityT).toBeCloseTo(5, 10);
        expect(mct88.picks[3].utilisationPct).toBeCloseTo(84, 10);

        expect(mct85.picks.map((pick) => pick.status)).toEqual([
            "PASS",
            "OUT_OF_RANGE",
            "OUT_OF_RANGE",
            "PASS",
            "OUT_OF_RANGE",
        ]);
        // 28.425 m is above the 27 m point (2.75 t) but at or below the 29 m
        // point (2.50 t); the chart rule uses the lower, larger-radius value.
        expect(mct85.picks[0].capacityT).toBeCloseTo(2.5, 10);
        expect(mct85.picks[0].utilisationPct).toBeCloseTo(80, 10);
        expect(mct85.picks[3].capacityT).toBeCloseTo(5, 10);
        expect(mct85.picks[3].utilisationPct).toBeCloseTo(84, 10);
    });

    test("marks only the crane that passes every pick", () => {
        // Five 2.6 t lifts at a 30 m radius from mast (0, 0):
        //   MCT 88: 81 / 30 = 2.70 t -> 2.6 / 2.70 = 96.3 % PASS.
        //   MCT 85 F5: 2.50 t at 30 m -> 2.6 / 2.50 = 104.0 % FAIL.
        const picks: Pick[] = ["P1", "P2", "P3", "P4", "P5"].map((label) => ({
            label,
            loadT: 2.6,
            supply: { x: 30, y: 0 },
            drop: { x: 0, y: 0 },
        }));

        const matrix = buildSelectionMatrix(TOWER_CRANES, picks, { mast: { x: 0, y: 0 } });

        expect(matrix.state).toBe("cranes-pass");
        expect(matrix.allPassCraneIds).toEqual(["potain-mct-88"]);
        expect(matrix.passingCraneCount).toBe(1);
        expect(matrix.rows[0].allPass).toBe(true);
        expect(matrix.rows[0].failedCount).toBe(0);
        expect(matrix.rows[1].allPass).toBe(false);
        expect(matrix.rows[1].failedCount).toBe(5);
    });

    test("reports honestly when no catalogue crane passes every sample pick", () => {
        const matrix = buildSelectionMatrix(TOWER_CRANES, samplePicks(), {
            mast: { x: 44, y: 17 },
        });

        expect(matrix.state).toBe("no-crane-passes");
        expect(matrix.allPassCraneIds).toEqual([]);
        expect(matrix.passingCraneCount).toBe(0);
        expect(matrix.rows.map((row) => row.failedCount)).toEqual([3, 3]);
    });

    test("reports a missing mast instead of inventing a position", () => {
        const matrix = buildSelectionMatrix(TOWER_CRANES, samplePicks());

        expect(matrix.state).toBe("missing-mast");
        expect(matrix.missingMastPickCount).toBe(5);
        expect(matrix.invalidPickCount).toBe(0);
        expect(
            matrix.rows.every((row) =>
                row.picks.every((pick) => pick.status === "INVALID" && pick.issue === "invalid-mast"),
            ),
        ).toBe(true);
        expect(matrix.passingCraneCount).toBe(0);
    });

    test("reports invalid pick coordinates as invalid input, not a capacity result", () => {
        const picks: Pick[] = [
            {
                label: "P1",
                loadT: 1,
                supply: { x: Number.NaN, y: 5.5 },
                drop: { x: 62, y: 39 },
            },
        ];

        const matrix = buildSelectionMatrix(TOWER_CRANES, picks, { mast: { x: 44, y: 17 } });

        expect(matrix.state).toBe("invalid-picks");
        expect(matrix.invalidPickCount).toBe(1);
        expect(matrix.missingMastPickCount).toBe(0);
        expect(
            matrix.rows.every(
                (row) => row.picks[0].status === "INVALID" && row.picks[0].issue === "invalid-coordinate",
            ),
        ).toBe(true);
    });

    test("reports an invalid load as invalid pick data", () => {
        const picks: Pick[] = [
            {
                label: "P1",
                loadT: 0,
                supply: { x: 0, y: 0 },
                drop: { x: 10, y: 0 },
            },
        ];

        const matrix = buildSelectionMatrix(TOWER_CRANES, picks, { mast: { x: 0, y: 0 } });

        expect(matrix.state).toBe("invalid-picks");
        expect(matrix.invalidPickCount).toBe(1);
        expect(matrix.rows[0].picks[0].issue).toBe("invalid-load");
    });

    test("reports an empty pick list without marking any crane as passing", () => {
        const matrix = buildSelectionMatrix(TOWER_CRANES, []);

        expect(matrix.state).toBe("no-picks");
        expect(matrix.pickCount).toBe(0);
        expect(matrix.passingCraneCount).toBe(0);
        expect(matrix.rows.every((row) => row.picks.length === 0 && !row.allPass)).toBe(true);
    });

    test("applies the shared wind derate to every crane row", () => {
        // MCT 88 at 20 m on the 30 m jib: 81 / 20 = 4.05 t. The SIMULATED
        // 20 km/h derate gives 4.05 x 0.8 = 3.24 t, so 3.5 t changes to FAIL.
        const picks: Pick[] = [{ label: "P1", loadT: 3.5, radiusM: 20 }];

        const calm = buildSelectionMatrix([MCT88], picks);
        expect(calm.state).toBe("cranes-pass");

        const windy = buildSelectionMatrix([MCT88], picks, { windKmh: 20 });
        expect(windy.rows[0].picks[0].capacityT).toBeCloseTo(3.24, 10);
        expect(windy.rows[0].picks[0].status).toBe("FAIL");
        expect(windy.state).toBe("no-crane-passes");
    });

    test("agrees with findCranesPassingAllPicks", () => {
        const picks = samplePicks();
        const options = { mast: { x: 44, y: 17 } };

        const matrix = buildSelectionMatrix(TOWER_CRANES, picks, options);

        expect(findCranesPassingAllPicks(TOWER_CRANES, picks, options).map((row) => row.craneId)).toEqual(
            matrix.allPassCraneIds,
        );
    });
});

describe("selectionReason", () => {
    test("maps PASS, FAIL, OUT_OF_RANGE and INVALID to a reason", () => {
        const pass = buildSelectionMatrix([MCT88], [{ loadT: 1, radiusM: 20 }]);
        expect(selectionReason(pass.rows[0].picks[0])).toBeUndefined();

        const fail = buildSelectionMatrix([MCT88], [{ loadT: 100, radiusM: 20 }]);
        expect(selectionReason(fail.rows[0].picks[0])).toBe("over-capacity");

        const outOfRange = buildSelectionMatrix([MCT88], [{ loadT: 1, radiusM: 40 }]);
        expect(selectionReason(outOfRange.rows[0].picks[0])).toBe("out-of-range");

        const invalid = buildSelectionMatrix(
            [MCT88],
            [{ loadT: 1, supply: { x: 0, y: 0 }, drop: { x: 10, y: 0 } }],
        );
        expect(selectionReason(invalid.rows[0].picks[0])).toBe("invalid-mast");
    });
});
