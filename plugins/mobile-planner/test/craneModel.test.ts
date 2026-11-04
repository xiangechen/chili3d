// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { capacityAt, expectedRadiusM, KIT, radiusFromPoint } from "../src/modules/craneModel";
import { createLiftSummary } from "../src/ui/liftSummary";

describe("mobile crane KIT", () => {
    test("is frozen and exposes source metadata", () => {
        expect(Object.isFrozen(KIT)).toBe(true);
        expect(Object.isFrozen(KIT.chart)).toBe(true);
        expect(KIT.chart.every((cell) => Object.isFrozen(cell))).toBe(true);
        expect(KIT.name).toBe("Grove GMK5250L-1");
        expect(KIT.PIVOT_OFFSET_M).toBe(0.8);
        expect(KIT.source).toEqual({
            document: "Grove GMK5250L-1 load chart, page 17",
            title: "2025-02-11_KB_MTW_PG_GMK5250L-1_V2.indd",
            craneModel: "Grove GMK5250L-1",
            url: "https://www.manitowoc.com/media/15016/download",
            page: 17,
            revision: "2025-02-11 / V2",
            status: "VERIFIED",
        });
    });

    test("uses the KIT pivot offset in the radius formula", () => {
        // Legacy formula: 32 m * cos(65.64 degrees) + 0.8 m = about 14.0 m.
        expect(expectedRadiusM(32, 65.64)).toBeCloseTo(14, 2);
        expect(radiusFromPoint({ xM: 3, yM: 4 })).toBeCloseTo(5.8, 6);
    });

    test("keeps the 70 m / 30 m chart cell at 12.1 t", () => {
        expect(capacityAt(70, 30)).toBeCloseTo(12.1, 6);
    });

    test("uses exact manufacturer values for the reported examples", () => {
        expect(capacityAt(38, 12)).toBe(47.5);
        expect(capacityAt(38, 11)).toBe(50.5);
    });

    test("returns every selected page-17 chart cell without interpolation", () => {
        expect(
            [
                [13.3, 5, 121],
                [13.3, 8, 84.5],
                [13.3, 10, 64.5],
                [23.6, 5, 111],
                [23.6, 8, 83.5],
                [23.6, 10, 68],
                [23.6, 11, 62],
                [23.6, 12, 57],
                [23.6, 15, 45],
                [23.6, 20, 27],
                [38, 5, 59],
                [38, 8, 58.5],
                [38, 10, 53],
                [38, 11, 50.5],
                [38, 12, 47.5],
                [38, 15, 40],
                [38, 20, 30.5],
                [38, 30, 17.2],
                [52.4, 10, 31],
                [52.4, 11, 31],
                [52.4, 12, 31],
                [52.4, 15, 28.5],
                [52.4, 20, 23.5],
                [52.4, 30, 15],
                [70, 12, 14.5],
                [70, 15, 14.5],
                [70, 20, 14.5],
                [70, 30, 12.1],
            ].map(([boomLengthM, radiusM, capacityT]) => [capacityAt(boomLengthM, radiusM), capacityT]),
        ).toEqual([
            [121, 121],
            [84.5, 84.5],
            [64.5, 64.5],
            [111, 111],
            [83.5, 83.5],
            [68, 68],
            [62, 62],
            [57, 57],
            [45, 45],
            [27, 27],
            [59, 59],
            [58.5, 58.5],
            [53, 53],
            [50.5, 50.5],
            [47.5, 47.5],
            [40, 40],
            [30.5, 30.5],
            [17.2, 17.2],
            [31, 31],
            [31, 31],
            [31, 31],
            [28.5, 28.5],
            [23.5, 23.5],
            [15, 15],
            [14.5, 14.5],
            [14.5, 14.5],
            [14.5, 14.5],
            [12.1, 12.1],
        ]);
    });

    test.each([
        [52.4, 8],
        [70, 10],
        [70, 11],
        [38, 7],
        [18.6, 5],
        [13.3, 20],
        [99, 10],
        [38, 40],
    ])("refuses unsupported chart input %s m / %s m", (boomLengthM, radiusM) => {
        expect(capacityAt(boomLengthM, radiusM)).toBeNull();
    });

    test.each([
        [38, 12, 47.5],
        [52.4, 20, 23.5],
        [70, 30, 12.1],
    ])("%s m / %s m gives %s t", (boomLengthM, radiusM, expectedCapacityT) => {
        // Each expected value is a frozen Cycle 3 KIT acceptance cell.
        expect(capacityAt(boomLengthM, radiusM)).toBeCloseTo(expectedCapacityT, 6);
    });

    test.each([
        [38, 12, "47.5"],
        [52.4, 20, "23.5"],
        [70, 30, "12.1"],
    ])("UI adapter shares model for %s m / %s m", (boomLengthM, radiusM, expectedCapacityT) => {
        const summary = createLiftSummary({ boomLengthM, radiusM });
        expect(summary).toContain(`${capacityAt(boomLengthM, radiusM)?.toFixed(1)} t`);
        expect(summary).toContain(`${expectedCapacityT} t`);
        expect(summary).toContain(KIT.name);
        expect(summary).toContain("Planning aid, not a certified lift plan.");
    });

    test.each([
        [Number.NaN, 10],
        [38, Number.POSITIVE_INFINITY],
        [-1, 10],
        [38, -1],
    ])("rejects invalid capacity input %s m / %s m", (boomLengthM, radiusM) => {
        expect(() => capacityAt(boomLengthM, radiusM)).toThrow();
    });

    test.each([
        [-1, 45],
        [32, -1],
        [32, 91],
        [32, Number.NaN],
    ])("rejects invalid radius calculation input %s m / %s degrees", (boomLengthM, angleDeg) => {
        expect(() => expectedRadiusM(boomLengthM, angleDeg)).toThrow();
    });
});
