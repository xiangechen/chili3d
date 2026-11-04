// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    calculateGroundBearing,
    calculatePadReactions,
    calculatePadReactionsFromLift,
    formatOutriggerSummary,
    getOutriggerFootprint,
    PLANNING_DISCLAIMER,
} from "../src/modules/outriggers";

describe("M3 Outrigger Pad Reactions", () => {
    // -------------------------------------------------------------------------
    // Acceptance Test 1: Symmetric case
    // "total weight W, 4 pads, load at centre = W/4 each"
    // -------------------------------------------------------------------------
    test.each([
        [40, 8, 6, 10],
        [60, 8.5, 7.2, 15],
        [100, 10, 8, 25],
    ])("symmetric case: total weight %s t on %s m x %s m gives exactly W/4 (%s t) per pad", (totalWeightT, lengthSpreadM, widthSpreadM, expectedPerPadT) => {
        const result = calculatePadReactions({
            totalWeightT,
            lengthSpreadM,
            widthSpreadM,
            eccentricityXM: 0,
            eccentricityYM: 0,
        });

        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(expectedPerPadT, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(expectedPerPadT, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(expectedPerPadT, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(expectedPerPadT, 6);

        expect(result.maxReactionT).toBeCloseTo(expectedPerPadT, 6);
        expect(result.minReactionT).toBeCloseTo(expectedPerPadT, 6);
        expect(result.isStable).toBe(true);

        // Sum of all pad reactions must strictly equal total weight W
        const sumOfReactions =
            result.reactions.frontLeft.reactionT +
            result.reactions.frontRight.reactionT +
            result.reactions.rearLeft.reactionT +
            result.reactions.rearRight.reactionT;
        expect(sumOfReactions).toBeCloseTo(totalWeightT, 6);
    });

    // -------------------------------------------------------------------------
    // Acceptance Test 2: Offset case (Longitudinal offset)
    // Hand calculation detailed in comment:
    //
    // Given parameters (user inputs):
    //   Total weight W = 60.0 t
    //   Longitudinal spread L = 8.0 m (front pads at x = +4.0 m, rear pads at x = -4.0 m)
    //   Transverse spread B = 6.0 m (left pads at y = +3.0 m, right pads at y = -3.0 m)
    //   Eccentricity e_x = +1.0 m (forward offset), e_y = 0.0 m
    //
    // Statics derivation by hand:
    //   1. Taking moments about the rear pads axis (x = -4.0 m):
    //      Distance to front pads = 8.0 m
    //      Distance from rear axis to load = 4.0 m + 1.0 m = 5.0 m
    //      Sum of M_rear = 0:
    //        (R_front_pair * 8.0 m) - (60.0 t * 5.0 m) = 0
    //        R_front_pair = 300.0 / 8.0 = 37.5 t
    //      By lateral symmetry (e_y = 0), front load is equally shared:
    //        R_FL = R_FR = 37.5 / 2 = 18.75 t
    //
    //   2. Vertical equilibrium:
    //      Sum of F_z = 0:
    //        R_rear_pair = W - R_front_pair = 60.0 t - 37.5 t = 22.5 t
    //      By lateral symmetry:
    //        R_RL = R_RR = 22.5 / 2 = 11.25 t
    //
    //   3. Total verification:
    //      18.75 + 18.75 + 11.25 + 11.25 = 60.0 t (exact).
    // -------------------------------------------------------------------------
    test("offset case (longitudinal) matches hand moment calculation", () => {
        const result = calculatePadReactions({
            totalWeightT: 60,
            lengthSpreadM: 8,
            widthSpreadM: 6,
            eccentricityXM: 1.0,
            eccentricityYM: 0.0,
        });

        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(18.75, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(18.75, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(11.25, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(11.25, 6);

        expect(result.maxReactionT).toBeCloseTo(18.75, 6);
        expect(result.minReactionT).toBeCloseTo(11.25, 6);
        expect(result.isStable).toBe(true);

        const sum =
            result.reactions.frontLeft.reactionT +
            result.reactions.frontRight.reactionT +
            result.reactions.rearLeft.reactionT +
            result.reactions.rearRight.reactionT;
        expect(sum).toBeCloseTo(60, 6);
    });

    // -------------------------------------------------------------------------
    // Acceptance Test 3: Offset case (Transverse offset)
    // Hand calculation detailed in comment:
    //
    // Given parameters:
    //   Total weight W = 60.0 t
    //   Longitudinal spread L = 8.0 m
    //   Transverse spread B = 6.0 m (left pads at y = +3.0 m, right pads at y = -3.0 m)
    //   Eccentricity e_x = 0.0 m, e_y = +1.5 m (slewed toward left)
    //
    // Statics derivation by hand:
    //   1. Taking moments about right pads line (y = -3.0 m):
    //      Distance to left pads = 6.0 m
    //      Distance from right line to load = 3.0 m + 1.5 m = 4.5 m
    //      Sum of M_right = 0:
    //        (R_left_pair * 6.0 m) - (60.0 t * 4.5 m) = 0
    //        R_left_pair = 270.0 / 6.0 = 45.0 t
    //      By longitudinal symmetry (e_x = 0):
    //        R_FL = R_RL = 45.0 / 2 = 22.5 t
    //
    //   2. Vertical equilibrium:
    //        R_right_pair = 60.0 t - 45.0 t = 15.0 t
    //        R_FR = R_RR = 15.0 / 2 = 7.5 t
    //
    //   3. Total verification:
    //      22.5 + 7.5 + 22.5 + 7.5 = 60.0 t.
    // -------------------------------------------------------------------------
    test("offset case (transverse) matches hand moment calculation", () => {
        const result = calculatePadReactions({
            totalWeightT: 60,
            lengthSpreadM: 8,
            widthSpreadM: 6,
            eccentricityXM: 0.0,
            eccentricityYM: 1.5,
        });

        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(7.5, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(7.5, 6);

        expect(result.maxReactionT).toBeCloseTo(22.5, 6);
        expect(result.minReactionT).toBeCloseTo(7.5, 6);
        expect(result.isStable).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Acceptance Test 4: Biaxial offset case (both X and Y offsets)
    // Hand calculation detailed in comment:
    //
    // Given:
    //   W = 60.0 t, L = 8.0 m, B = 6.0 m, e_x = 1.0 m, e_y = 0.75 m
    //
    // Analytical formula:
    //   Base reaction R_0 = W / 4 = 15.0 t
    //   delta_x = W * e_x / (2 * L) = 60 * 1.0 / 16.0 = 3.75 t
    //   delta_y = W * e_y / (2 * B) = 60 * 0.75 / 12.0 = 3.75 t
    //
    // Reactions:
    //   FL (+x, +y): 15.0 + 3.75 + 3.75 = 22.5 t
    //   FR (+x, -y): 15.0 + 3.75 - 3.75 = 15.0 t
    //   RL (-x, +y): 15.0 - 3.75 + 3.75 = 15.0 t
    //   RR (-x, -y): 15.0 - 3.75 - 3.75 = 7.5 t
    //
    // Check equilibrium:
    //   Sum F_z = 22.5 + 15.0 + 15.0 + 7.5 = 60.0 t
    //   Moment M_y (about y axis, sum R * x):
    //     (22.5 * 4) + (15.0 * 4) - (15.0 * 4) - (7.5 * 4) = (22.5 - 7.5) * 4 = 15.0 * 4 = 60.0 t*m
    //     W * e_x = 60.0 * 1.0 = 60.0 t*m (matches!)
    //   Moment M_x (about x axis, sum R * y):
    //     (22.5 * 3) - (15.0 * 3) + (15.0 * 3) - (7.5 * 3) = (22.5 - 7.5) * 3 = 15.0 * 3 = 45.0 t*m
    //     W * e_y = 60.0 * 0.75 = 45.0 t*m (matches!)
    // -------------------------------------------------------------------------
    test("biaxial offset matches analytical equilibrium", () => {
        const result = calculatePadReactions({
            totalWeightT: 60,
            lengthSpreadM: 8,
            widthSpreadM: 6,
            eccentricityXM: 1.0,
            eccentricityYM: 0.75,
        });

        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(15.0, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(15.0, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(7.5, 6);

        expect(result.maxReactionT).toBeCloseTo(22.5, 6);
        expect(result.minReactionT).toBeCloseTo(7.5, 6);
        expect(result.isStable).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Acceptance Test 5: Tipping / uplift condition (negative reaction)
    // Hand calculation:
    //   W = 60 t, L = 8 m, B = 6 m
    //   e_x = 3.0 m (near front outrigger edge 4.0 m)
    //   e_y = 2.0 m (near left outrigger edge 3.0 m)
    //   delta_x = 60 * 3.0 / 16.0 = 11.25 t
    //   delta_y = 60 * 2.0 / 12.0 = 10.0 t
    //   RR reaction = 15.0 - 11.25 - 10.0 = -6.25 t < 0
    //   This means rear-right outrigger lifts off the ground (tipping).
    // -------------------------------------------------------------------------
    test("detects pad uplift and marks unstable when reaction goes negative", () => {
        const result = calculatePadReactions({
            totalWeightT: 60,
            lengthSpreadM: 8,
            widthSpreadM: 6,
            eccentricityXM: 3.0,
            eccentricityYM: 2.0,
        });

        expect(result.reactions.rearRight.reactionT).toBeCloseTo(-6.25, 6);
        expect(result.minReactionT).toBeCloseTo(-6.25, 6);
        expect(result.isStable).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Test 6: Crane lift input with slew angle and radius
    // Hand calculation:
    //   Empty crane = 50.0 t at center (0, 0)
    //   Lifted load = 10.0 t at radius 12.0 m, slew 0 deg (+X / front)
    //   Total weight W = 60.0 t
    //   Load pos = (12.0, 0.0)
    //   e_x = (50*0 + 10*12) / 60 = 2.0 m, e_y = 0.0 m
    //   delta_x = 60 * 2.0 / 16.0 = 7.5 t
    //   R_front = 15.0 + 7.5 = 22.5 t each
    //   R_rear = 15.0 - 7.5 = 7.5 t each
    // -------------------------------------------------------------------------
    test("calculates reactions correctly from crane lift parameters", () => {
        const result = calculatePadReactionsFromLift({
            craneWeightT: 50,
            liftedLoadT: 10,
            radiusM: 12,
            slewAngleDeg: 0,
            lengthSpreadM: 8,
            widthSpreadM: 6,
        });

        expect(result.totalWeightT).toBe(60);
        expect(result.eccentricityXM).toBeCloseTo(2.0, 6);
        expect(result.eccentricityYM).toBeCloseTo(0.0, 6);
        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(7.5, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(7.5, 6);
    });

    // -------------------------------------------------------------------------
    // Test 7: Outrigger footprint polygon coordinates
    // -------------------------------------------------------------------------
    test("computes accurate outrigger footprint polygon", () => {
        const footprint = getOutriggerFootprint({
            lengthSpreadM: 8,
            widthSpreadM: 6,
        });

        expect(footprint.pads.frontLeft).toEqual({ xM: 4, yM: 3 });
        expect(footprint.pads.frontRight).toEqual({ xM: 4, yM: -3 });
        expect(footprint.pads.rearRight).toEqual({ xM: -4, yM: -3 });
        expect(footprint.pads.rearLeft).toEqual({ xM: -4, yM: 3 });

        expect(footprint.polygon).toHaveLength(4);
        expect(footprint.polygon[0]).toEqual({ xM: 4, yM: 3 });
    });

    // -------------------------------------------------------------------------
    // Test 8: Ground bearing pressure calculation
    // -------------------------------------------------------------------------
    test("calculates ground bearing pressure and PASS/FAIL against allowable", () => {
        const passCase = calculateGroundBearing(22.5, 1.0, 25.0);
        expect(passCase.pressureT_M2).toBeCloseTo(22.5, 6);
        expect(passCase.pressureKPa).toBeCloseTo(22.5 * 9.80665, 4);
        expect(passCase.status).toBe("PASS");
        expect(passCase.isAllowableExceeded).toBe(false);

        const failCase = calculateGroundBearing(22.5, 1.0, 20.0);
        expect(failCase.status).toBe("FAIL");
        expect(failCase.isAllowableExceeded).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Test 9: Mandatory disclaimer present
    // -------------------------------------------------------------------------
    test("always includes required planning disclaimer", () => {
        const result = calculatePadReactions({
            totalWeightT: 60,
            lengthSpreadM: 8,
            widthSpreadM: 6,
        });

        expect(result.disclaimer).toBe("Planning aid, not a certified lift plan.");
        expect(PLANNING_DISCLAIMER).toBe("Planning aid, not a certified lift plan.");

        const summary = formatOutriggerSummary(result);
        expect(summary).toContain("Planning aid, not a certified lift plan.");
        expect(summary).toContain("W = 60.0 t");
    });

    // -------------------------------------------------------------------------
    // Test 10: Input validation and defensive checks
    // -------------------------------------------------------------------------
    test.each([
        [{ totalWeightT: -10, lengthSpreadM: 8, widthSpreadM: 6 }, "totalWeightT"],
        [{ totalWeightT: 0, lengthSpreadM: 8, widthSpreadM: 6 }, "totalWeightT"],
        [{ totalWeightT: 60, lengthSpreadM: 0, widthSpreadM: 6 }, "lengthSpreadM"],
        [{ totalWeightT: 60, lengthSpreadM: -5, widthSpreadM: 6 }, "lengthSpreadM"],
        [{ totalWeightT: 60, lengthSpreadM: 8, widthSpreadM: 0 }, "widthSpreadM"],
        [{ totalWeightT: Number.NaN, lengthSpreadM: 8, widthSpreadM: 6 }, "totalWeightT"],
        [
            { totalWeightT: 60, lengthSpreadM: 8, widthSpreadM: 6, eccentricityXM: Number.POSITIVE_INFINITY },
            "eccentricityXM",
        ],
    ])("rejects invalid input %j with parameter error for %s", (invalidInput, paramName) => {
        expect(() => calculatePadReactions(invalidInput)).toThrow(paramName);
    });
});

describe("M3/M4 fail-safe and extra hand-calculation cases", () => {
    // Case 5 above gives RR = 15.0 - 11.25 - 10.0 = -6.25 t (pad has lifted off).
    test("ground bearing never returns PASS for a pad with negative reaction", () => {
        const result = calculatePadReactions({
            totalWeightT: 60,
            lengthSpreadM: 8,
            widthSpreadM: 6,
            eccentricityXM: 3,
            eccentricityYM: 2,
        });
        const rr = result.reactions.rearRight.reactionT;
        expect(rr).toBeCloseTo(-6.25, 10);
        expect(calculateGroundBearing(rr, 1.0, 10).status).toBe("FAIL");
        expect(calculateGroundBearing(rr, 1.0).status).toBe("FAIL");
    });

    test("ground bearing without an allowable is NOT_CHECKED, not PASS", () => {
        const result = calculateGroundBearing(22.5, 1.0);
        expect(result.status).toBe("NOT_CHECKED");
        expect(result.isAllowableExceeded).toBeUndefined();
    });

    // Slew 90 deg = toward +Y (left). W = 50 + 10 = 60 t, load at (0, 9 m).
    // e_y = 10 * 9 / 60 = 1.5 m, delta_y = 60 * 1.5 / (2 * 6) = 7.5 t
    // left pads 15 + 7.5 = 22.5 t, right pads 15 - 7.5 = 7.5 t
    test("slew 90 deg loads the left pads (hand calculation)", () => {
        const result = calculatePadReactionsFromLift({
            craneWeightT: 50,
            liftedLoadT: 10,
            radiusM: 9,
            slewAngleDeg: 90,
            lengthSpreadM: 8,
            widthSpreadM: 6,
        });
        expect(result.eccentricityXM).toBeCloseTo(0, 9);
        expect(result.eccentricityYM).toBeCloseTo(1.5, 9);
        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(7.5, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(7.5, 6);
    });

    // Slew 180 deg = toward the rear (-X). Load at (-12 m, 0): e_x = -10 * 12 / 60 = -2 m,
    // delta_x = 60 * (-2) / 16 = -7.5 t -> front pads 7.5 t, rear pads 22.5 t
    test("slew 180 deg loads the rear pads (hand calculation)", () => {
        const result = calculatePadReactionsFromLift({
            craneWeightT: 50,
            liftedLoadT: 10,
            radiusM: 12,
            slewAngleDeg: 180,
            lengthSpreadM: 8,
            widthSpreadM: 6,
        });
        expect(result.eccentricityXM).toBeCloseTo(-2, 9);
        expect(result.reactions.frontLeft.reactionT).toBeCloseTo(7.5, 6);
        expect(result.reactions.frontRight.reactionT).toBeCloseTo(7.5, 6);
        expect(result.reactions.rearLeft.reactionT).toBeCloseTo(22.5, 6);
        expect(result.reactions.rearRight.reactionT).toBeCloseTo(22.5, 6);
    });

    // Heading 90 deg, centre (10, 20): local FL (4, 3) -> (x cos - y sin, x sin + y cos) = (-3, 4) -> (7, 24)
    // local FR (4, -3) -> (3, 4) -> (13, 24)
    test("footprint follows centre and heading (hand calculation)", () => {
        const footprint = getOutriggerFootprint({
            lengthSpreadM: 8,
            widthSpreadM: 6,
            center: { xM: 10, yM: 20 },
            headingRad: Math.PI / 2,
        });
        expect(footprint.pads.frontLeft.xM).toBeCloseTo(7, 9);
        expect(footprint.pads.frontLeft.yM).toBeCloseTo(24, 9);
        expect(footprint.pads.frontRight.xM).toBeCloseTo(13, 9);
        expect(footprint.pads.frontRight.yM).toBeCloseTo(24, 9);
    });

    test("lift and ground bearing inputs reject invalid values", () => {
        const base = {
            craneWeightT: 50,
            liftedLoadT: 10,
            radiusM: 12,
            slewAngleDeg: 0,
            lengthSpreadM: 8,
            widthSpreadM: 6,
        };
        expect(() => calculatePadReactionsFromLift({ ...base, liftedLoadT: -1 })).toThrow("liftedLoadT");
        expect(() => calculatePadReactionsFromLift({ ...base, radiusM: -1 })).toThrow("radiusM");
        expect(() => calculateGroundBearing(Number.NaN, 1)).toThrow("reactionT");
        expect(() => calculateGroundBearing(10, 0)).toThrow("padAreaM2");
    });
});
