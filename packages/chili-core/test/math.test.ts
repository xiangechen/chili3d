// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils } from "../src";

describe("test math", () => {
    test("test anyEqualZero", () => {
        expect(MathUtils.anyEqualZero(0.00000000000000000001)).toBeTruthy();
        expect(MathUtils.anyEqualZero(1)).toBeFalsy();
        expect(MathUtils.anyEqualZero(1, 1, 1)).toBeFalsy();
        expect(MathUtils.anyEqualZero(1, 0, 1)).toBeTruthy();
        expect(MathUtils.anyEqualZero(1, 0.0000000000000000001, 1)).toBeTruthy();
    });

    test("test allEqualZero", () => {
        expect(MathUtils.allEqualZero(0.00000000000000000001)).toBeTruthy();
        expect(MathUtils.allEqualZero(1)).toBeFalsy();
        expect(MathUtils.allEqualZero(1, 1, 1)).toBeFalsy();
        expect(MathUtils.allEqualZero(0, 0, 0.000000000000000001)).toBeTruthy();
        expect(MathUtils.allEqualZero(0, 0, 0)).toBeTruthy();
    });

    test("test almostEqual", () => {
        expect(MathUtils.almostEqual(1, 1, 0.01)).toBeTruthy();
        expect(MathUtils.almostEqual(1.001, 1.002, 0.01)).toBeTruthy();
        expect(MathUtils.almostEqual(1.001, 1.002, 0.001)).toBeFalsy();
    });

    test("test clamp", () => {
        expect(MathUtils.clamp(1, 2, 3)).toBe(2);
        expect(MathUtils.clamp(2.5, 2, 3)).toBe(2.5);
        expect(MathUtils.clamp(4, 2, 3)).toBe(3);
    });
});
