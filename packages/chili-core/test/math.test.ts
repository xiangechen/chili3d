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
});

describe("MathUtils.computeLineSegmentDistance", () => {
    test("should return correct distance for parallel segments", () => {
        const seg1Start = new XYZ(0, 0, 0);
        const seg1End = new XYZ(1, 0, 0);
        const seg2Start = new XYZ(0, 1, 0);
        const seg2End = new XYZ(1, 1, 0);

        const result = MathUtils.computeLineSegmentDistance(seg1Start, seg1End, seg2Start, seg2End);
        expect(result.distance).toBeCloseTo(1);
        expect(result.pointOnSeg1).toEqual(new XYZ(0, 0, 0));
        expect(result.pointOnSeg2).toEqual(new XYZ(0, 1, 0));
    });

    test("should return 0 distance for intersecting segments", () => {
        const seg1Start = new XYZ(0, 0, 0);
        const seg1End = new XYZ(1, 1, 0);
        const seg2Start = new XYZ(0, 1, 0);
        const seg2End = new XYZ(1, 0, 0);

        const result = MathUtils.computeLineSegmentDistance(seg1Start, seg1End, seg2Start, seg2End);
        expect(result.distance).toBeCloseTo(0);
        expect(result.pointOnSeg1.x).toBeCloseTo(0.5);
        expect(result.pointOnSeg1.y).toBeCloseTo(0.5);
        expect(result.pointOnSeg2.x).toBeCloseTo(0.5);
        expect(result.pointOnSeg2.y).toBeCloseTo(0.5);
    });

    test("should handle collinear but non-overlapping segments", () => {
        const seg1Start = new XYZ(0, 0, 0);
        const seg1End = new XYZ(1, 0, 0);
        const seg2Start = new XYZ(2, 0, 0);
        const seg2End = new XYZ(3, 0, 0);

        const result = MathUtils.computeLineSegmentDistance(seg1Start, seg1End, seg2Start, seg2End);
        expect(result.distance).toBeCloseTo(1);
        expect(result.pointOnSeg1).toEqual(new XYZ(1, 0, 0));
        expect(result.pointOnSeg2).toEqual(new XYZ(2, 0, 0));
    });

    test("should work correctly in 3D space", () => {
        const seg1Start = new XYZ(0, 0, 0);
        const seg1End = new XYZ(1, 1, 1);
        const seg2Start = new XYZ(0, 0, 1);
        const seg2End = new XYZ(1, 1, 0);

        const result = MathUtils.computeLineSegmentDistance(seg1Start, seg1End, seg2Start, seg2End);
        expect(result.distance).toBeCloseTo(0);
    });

    test('should handle when closest points are at line endpoints', () => {
        const p11 = new XYZ(0, 0, 0);
        const p12 = new XYZ(1, 0, 0);
        const p21 = new XYZ(2, 1, 0);
        const p22 = new XYZ(2, 2, 0);
        const p23 = new XYZ(3, 1, 0);

        const result = MathUtils.computeLineSegmentDistance(p11, p12, p21, p22);
        expect(result.distance).toBeCloseTo(1.414, 2);
        expect(result.pointOnSeg1).toEqual(new XYZ(1, 0, 0));
        expect(result.pointOnSeg2).toEqual(new XYZ(2, 1, 0));

        const result2 = MathUtils.computeLineSegmentDistance(p11, p12, p21, p23);
        expect(result2.distance).toBeCloseTo(1.414, 2);
        expect(result2.pointOnSeg1).toEqual(new XYZ(1, 0, 0));
        expect(result2.pointOnSeg2).toEqual(new XYZ(2, 1, 0));
    });

    test("should handle parameters close to zero", () => {
        const seg1Start = new XYZ(0, 0, 0);
        const seg1End = new XYZ(1, 0, 0);
        const seg2Start = new XYZ(0.5, Precision.Float / 2, 0);
        const seg2End = new XYZ(0.5, 1, 0);

        const result = MathUtils.computeLineSegmentDistance(seg1Start, seg1End, seg2Start, seg2End);
        expect(result.distance).toBeGreaterThan(0);
    });

    test("should handle zero-length segments", () => {
        const seg1Start = new XYZ(0, 0, 0);
        const seg1End = new XYZ(0, 0, 0);
        const seg2Start = new XYZ(1, 0, 0);
        const seg2End = new XYZ(1, 0, 0);

        const result = MathUtils.computeLineSegmentDistance(seg1Start, seg1End, seg2Start, seg2End);
        expect(result.distance).toBeCloseTo(1);
    });
});