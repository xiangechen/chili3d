// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { calculateLiftCheck } from "../src/modules/liftCheck";

const cranePosition = { xM: 0, yM: 0 };

describe("M2 mobile crane lift check", () => {
    test("flags the pick point when it has the greater radius", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 11.2, yM: 0 },
            setPoint: { xM: 10.2, yM: 0 },
            loadWeightT: 10,
            riggingWeightT: 1,
            boomLengthM: 38,
        });

        expect(result.pickRadiusM).toBeCloseTo(12, 6);
        expect(result.setRadiusM).toBeCloseTo(11, 6);
        expect(result.requiredRadiusM).toBeCloseTo(12, 6);
        expect(result.worstRadiusPoint).toBe("pick");
    });

    test("flags the set point when it has the greater radius", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 10.2, yM: 0 },
            setPoint: { xM: 11.2, yM: 0 },
            loadWeightT: 10,
            riggingWeightT: 1,
            boomLengthM: 38,
        });

        expect(result.requiredRadiusM).toBeCloseTo(12, 6);
        expect(result.worstRadiusPoint).toBe("set");
    });

    test("flags pick when both points have equal radii", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 11.2, yM: 0 },
            setPoint: { xM: 0, yM: 11.2 },
            loadWeightT: 10,
            riggingWeightT: 1,
            boomLengthM: 38,
        });

        expect(result.pickRadiusM).toBeCloseTo(result.setRadiusM, 6);
        expect(result.requiredRadiusM).toBeCloseTo(12, 6);
        expect(result.worstRadiusPoint).toBe("pick");
    });

    test("matches the hand-worked M2 lift example", () => {
        // Hand calculation: pick radius = sqrt(3^2 + 4^2) + 0.8 = 5.8 m;
        // set radius = 11.2 + 0.8 = 12.0 m, so required radius is 12.0 m at set.
        // The 38 m / 12 m KIT cell gives 47.5 t; total load is 40 + 2 = 42 t,
        // and utilisation is 42 / 47.5 * 100 = approximately 88.42%, so PASS.
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 3, yM: 4 },
            setPoint: { xM: 11.2, yM: 0 },
            loadWeightT: 40,
            riggingWeightT: 2,
            boomLengthM: 38,
        });

        expect(result.pickRadiusM).toBeCloseTo(5.8, 6);
        expect(result.setRadiusM).toBeCloseTo(12, 6);
        expect(result.requiredRadiusM).toBeCloseTo(12, 6);
        expect(result.worstRadiusPoint).toBe("set");
        expect(result.capacityT).toBe(47.5);
        expect(result.totalLoadT).toBe(42);
        expect(result.utilisationPct).toBeCloseTo(88.42, 2);
        expect(result.status).toBe("PASS");
    });

    test("uses the exact supported 38 m / 12 m KIT chart cell", () => {
        // Hand check: 11.2 m horizontal distance + 0.8 m KIT pivot offset = 12.0 m radius.
        // Total load = 40.0 t + 2.0 t rigging = 42.0 t; 42.0 / 47.5 = 88.421...%.
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 11.2, yM: 0 },
            setPoint: { xM: 11.2, yM: 0 },
            loadWeightT: 40,
            riggingWeightT: 2,
            boomLengthM: 38,
        });

        expect(result.capacityT).toBe(47.5);
        expect(result.totalLoadT).toBe(42);
        expect(result.utilisationPct).toBeCloseTo((42 / 47.5) * 100, 6);
    });

    test("returns UNSUPPORTED for an unpublished radius", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 10.7, yM: 0 },
            setPoint: { xM: 10.7, yM: 0 },
            loadWeightT: 10,
            riggingWeightT: 1,
            boomLengthM: 38,
        });

        expect(result.requiredRadiusM).toBeCloseTo(11.5, 6);
        expect(result.capacityT).toBeNull();
        expect(result.utilisationPct).toBeNull();
        expect(result.status).toBe("UNSUPPORTED");
    });

    test("returns FAIL when total load exceeds capacity", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 11.2, yM: 0 },
            setPoint: { xM: 11.2, yM: 0 },
            loadWeightT: 47,
            riggingWeightT: 1,
            boomLengthM: 38,
        });

        expect(result.capacityT).toBe(47.5);
        expect(result.totalLoadT).toBe(48);
        expect(result.status).toBe("FAIL");
    });

    test("returns PASS when load plus rigging is within capacity", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 10.2, yM: 0 },
            setPoint: { xM: 10.2, yM: 0 },
            loadWeightT: 40,
            riggingWeightT: 2,
            boomLengthM: 38,
        });

        expect(result.capacityT).toBe(50.5);
        expect(result.totalLoadT).toBe(42);
        expect(result.status).toBe("PASS");
    });

    test("includes the required planning disclaimer", () => {
        const result = calculateLiftCheck({
            cranePosition,
            pickPoint: { xM: 11.2, yM: 0 },
            setPoint: { xM: 11.2, yM: 0 },
            loadWeightT: 1,
            riggingWeightT: 0,
            boomLengthM: 38,
        });

        expect(result.disclaimer).toBe("Planning aid, not a certified lift plan.");
    });

    test("rejects a negative boom length", () => {
        expect(() =>
            calculateLiftCheck({
                cranePosition,
                pickPoint: { xM: 11.2, yM: 0 },
                setPoint: { xM: 11.2, yM: 0 },
                loadWeightT: 1,
                riggingWeightT: 0,
                boomLengthM: -1,
            }),
        ).toThrow();
    });

    test("rejects total load overflow from individually finite weights", () => {
        expect(() =>
            calculateLiftCheck({
                cranePosition,
                pickPoint: { xM: 11.2, yM: 0 },
                setPoint: { xM: 11.2, yM: 0 },
                loadWeightT: Number.MAX_VALUE,
                riggingWeightT: Number.MAX_VALUE,
                boomLengthM: 38,
            }),
        ).toThrow();
    });

    test.each([
        ["crane x coordinate", { xM: Number.NaN, yM: 0 }, { xM: 11.2, yM: 0 }, cranePosition, 1, 0, 38],
        [
            "pick y coordinate",
            cranePosition,
            { xM: 11.2, yM: Number.POSITIVE_INFINITY },
            cranePosition,
            1,
            0,
            38,
        ],
        ["set x coordinate", cranePosition, cranePosition, { xM: Number.NEGATIVE_INFINITY, yM: 0 }, 1, 0, 38],
        ["negative load", cranePosition, { xM: 11.2, yM: 0 }, { xM: 11.2, yM: 0 }, -1, 0, 38],
        ["negative rigging", cranePosition, { xM: 11.2, yM: 0 }, { xM: 11.2, yM: 0 }, 1, -1, 38],
        ["NaN load", cranePosition, { xM: 11.2, yM: 0 }, { xM: 11.2, yM: 0 }, Number.NaN, 0, 38],
        [
            "infinite rigging",
            cranePosition,
            { xM: 11.2, yM: 0 },
            { xM: 11.2, yM: 0 },
            1,
            Number.POSITIVE_INFINITY,
            38,
        ],
    ])("rejects invalid input: %s", (_label, testCranePosition, pickPoint, setPoint, loadWeightT, riggingWeightT, boomLengthM) => {
        expect(() =>
            calculateLiftCheck({
                cranePosition: testCranePosition,
                pickPoint,
                setPoint,
                loadWeightT,
                riggingWeightT,
                boomLengthM,
            }),
        ).toThrow();
    });
});
