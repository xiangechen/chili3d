// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type ICircle, type ICurve, type ITrimmedCurve, XYZ } from "../src";

/**
 * Build a minimal ICurve-like object for testing type-guard functions.
 * Uses a plain record to allow duck-typing properties not present on ICurve itself
 * (e.g. axis from IConic, center/radius from ICircle, direction from ILine).
 */
function createMockCurve(overrides: Record<string, unknown> = {}): ICurve {
    return {
        curveType: "otherCurve",
        geometryType: "curve",
        uniformAbscissaByLength: () => [],
        uniformAbscissaByCount: () => [],
        length: () => 0,
        parameter: () => undefined,
        firstParameter: () => 0,
        lastParameter: () => 0,
        project: () => [],
        value: () => XYZ.zero,
        isCN: () => false,
        trim: () => ({}) as ITrimmedCurve,
        d0: () => XYZ.zero,
        d1: () => ({ point: XYZ.zero, vec: XYZ.zero }),
        d2: () => ({ point: XYZ.zero, vec1: XYZ.zero, vec2: XYZ.zero }),
        d3: () => ({ point: XYZ.zero, vec1: XYZ.zero, vec2: XYZ.zero, vec3: XYZ.zero }),
        dn: () => XYZ.zero,
        reverse: () => {},
        reversed: () => ({}) as ICurve,
        nearestFromPoint: () => ({ point: XYZ.zero, parameter: 0, distance: 0 }),
        nearestExtrema: () => undefined,
        isClosed: () => false,
        period: () => 0,
        isPeriodic: () => false,
        continuity: () => "c0",
        transform: () => {},
        transformed: () => ({}) as ICurve,
        copy: () => ({}) as ICurve,
        dispose: () => {},
        ...overrides,
    } as unknown as ICurve;
}

describe("CurveUtils", () => {
    describe("isConic", () => {
        test("should return true when curve has axis", () => {
            const conic = createMockCurve({ axis: XYZ.unitZ });
            expect(CurveUtils.isConic(conic)).toBeTruthy();
        });

        test("should return false when curve has no axis", () => {
            const curve = createMockCurve();
            expect(CurveUtils.isConic(curve)).toBeFalsy();
        });

        test("should return false when axis is undefined", () => {
            const curve = createMockCurve({ axis: undefined });
            expect(CurveUtils.isConic(curve)).toBeFalsy();
        });
    });

    describe("isCircle", () => {
        test("should return true when curve has center and radius", () => {
            const circle = createMockCurve({
                curveType: "circle",
                center: XYZ.zero,
                radius: 5,
            });
            expect(CurveUtils.isCircle(circle)).toBeTruthy();
        });

        test("should return false when curve has center but no radius", () => {
            const curve = createMockCurve({
                center: XYZ.zero,
                radius: undefined,
            });
            expect(CurveUtils.isCircle(curve)).toBeFalsy();
        });

        test("should return false when curve has radius but no center", () => {
            const curve = createMockCurve({
                radius: 5,
                center: undefined,
            });
            expect(CurveUtils.isCircle(curve)).toBeFalsy();
        });

        test("should return false when curve has neither center nor radius", () => {
            const curve = createMockCurve();
            expect(CurveUtils.isCircle(curve)).toBeFalsy();
        });
    });

    describe("isLine", () => {
        test("should return true when curve has direction", () => {
            const line = createMockCurve({ direction: XYZ.unitX });
            expect(CurveUtils.isLine(line)).toBeTruthy();
        });

        test("should return false when curve has no direction", () => {
            const curve = createMockCurve();
            expect(CurveUtils.isLine(curve)).toBeFalsy();
        });

        test("should return false when direction is undefined", () => {
            const curve = createMockCurve({ direction: undefined });
            expect(CurveUtils.isLine(curve)).toBeFalsy();
        });
    });

    describe("isTrimmed", () => {
        test("should return true when curve has basisCurve", () => {
            const trimmed = createMockCurve({
                curveType: "trimmedCurve",
                basisCurve: createMockCurve(),
            });
            expect(CurveUtils.isTrimmed(trimmed)).toBeTruthy();
        });

        test("should return false when curve has no basisCurve", () => {
            const curve = createMockCurve();
            expect(CurveUtils.isTrimmed(curve)).toBeFalsy();
        });

        test("should return false when basisCurve is undefined", () => {
            const curve = createMockCurve({ basisCurve: undefined });
            expect(CurveUtils.isTrimmed(curve)).toBeFalsy();
        });
    });

    describe("tangentPoints", () => {
        function makeCircle(center: XYZ, radius: number, axis: XYZ): ICircle {
            return { center, radius, axis } as unknown as ICircle;
        }

        test("should return two tangent points for point outside circle", () => {
            const circle = makeCircle(XYZ.zero, 1, XYZ.unitZ);
            const point = new XYZ({ x: 2, y: 0, z: 0 });

            const result = CurveUtils.tangentPoints(circle, point);
            expect(result.length).toBe(2);

            for (const tp of result) {
                expect(tp.distanceTo(circle.center)).toBeCloseTo(1, 5);
            }

            expect(result[0].isEqualTo(result[1])).toBeFalsy();
        });

        test("should return correct tangent points for symmetric case", () => {
            const circle = makeCircle(XYZ.zero, 1, XYZ.unitZ);
            const point = new XYZ({ x: 2, y: 0, z: 0 });

            const result = CurveUtils.tangentPoints(circle, point);
            // alpha = acos(1/2) = π/3, cos(π/3)=0.5, sin(π/3)=√3/2≈0.866
            const yValues = result.map((p) => Math.abs(p.y)).sort();
            expect(yValues[0]).toBeCloseTo(0.866, 2);
            expect(yValues[1]).toBeCloseTo(0.866, 2);
        });

        test("should return empty array when point is inside circle", () => {
            const circle = makeCircle(XYZ.zero, 5, XYZ.unitZ);
            const point = new XYZ({ x: 1, y: 0, z: 0 });
            expect(CurveUtils.tangentPoints(circle, point).length).toBe(0);
        });

        test("should return empty array when point is on the circle", () => {
            const circle = makeCircle(XYZ.zero, 1, XYZ.unitZ);
            const point = new XYZ({ x: 1, y: 0, z: 0 });
            expect(CurveUtils.tangentPoints(circle, point).length).toBe(0);
        });

        test("should return empty array when point is not coplanar with circle", () => {
            const circle = makeCircle(XYZ.zero, 5, XYZ.unitZ);
            const point = new XYZ({ x: 10, y: 0, z: 5 });
            expect(CurveUtils.tangentPoints(circle, point).length).toBe(0);
        });

        test("should work with translated circle center", () => {
            const center = new XYZ({ x: 10, y: 10, z: 0 });
            const circle = makeCircle(center, 2, XYZ.unitZ);
            const point = new XYZ({ x: 15, y: 10, z: 0 });

            const result = CurveUtils.tangentPoints(circle, point);
            expect(result.length).toBe(2);
            for (const tp of result) {
                expect(tp.distanceTo(center)).toBeCloseTo(2, 5);
            }
        });
    });
});
