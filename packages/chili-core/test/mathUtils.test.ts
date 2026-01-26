// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils, Precision, XYZ } from "../src";

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

    test("test degToRad", () => {
        expect(MathUtils.degToRad(0)).toBe(0);
        expect(MathUtils.degToRad(90)).toBeCloseTo(Math.PI / 2);
        expect(MathUtils.degToRad(180)).toBeCloseTo(Math.PI);
        expect(MathUtils.degToRad(360)).toBeCloseTo(2 * Math.PI);
    });

    test("test radToDeg", () => {
        expect(MathUtils.radToDeg(0)).toBe(0);
        expect(MathUtils.radToDeg(Math.PI / 2)).toBeCloseTo(90);
        expect(MathUtils.radToDeg(Math.PI)).toBeCloseTo(180);
        expect(MathUtils.radToDeg(2 * Math.PI)).toBeCloseTo(360);
    });

    test("test minMax", () => {
        expect(MathUtils.minMax([])).toBeUndefined();
        expect(MathUtils.minMax([5])).toEqual({ min: 5, max: 5 });
        expect(MathUtils.minMax([1, 2, 3, 4, 5])).toEqual({ min: 1, max: 5 });
        expect(MathUtils.minMax([5, 4, 3, 2, 1])).toEqual({ min: 1, max: 5 });
        expect(MathUtils.minMax([-2, 0, 2])).toEqual({ min: -2, max: 2 });
        expect(MathUtils.minMax([3.5, 1.2, 4.8])).toEqual({ min: 1.2, max: 4.8 });

        // Test with typed array
        const float32Array = new Float32Array([1, 5, 3]);
        expect(MathUtils.minMax(float32Array)).toEqual({ min: 1, max: 5 });
    });
});
