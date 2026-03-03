// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Ray, XYZ } from "../src";

describe("Ray", () => {
    describe("constructor", () => {
        test("should create ray with point and direction", () => {
            const point = new XYZ(1, 2, 3);
            const direction = new XYZ(1, 0, 0);
            const ray = new Ray(point, direction);

            expect(ray.point).toEqual(point);
            expect(ray.direction.isEqualTo(XYZ.unitX)).toBe(true);
        });

        test("should normalize direction", () => {
            const point = new XYZ(0, 0, 0);
            const direction = new XYZ(2, 0, 0);
            const ray = new Ray(point, direction);

            expect(ray.direction.length()).toBeCloseTo(1);
            expect(ray.direction.isEqualTo(XYZ.unitX)).toBe(true);
        });

        test("should throw error for zero direction", () => {
            const point = new XYZ(0, 0, 0);
            const direction = XYZ.zero;

            expect(() => new Ray(point, direction)).toThrow("direction can not be zero");
        });

        test("should throw error for very small direction", () => {
            const point = new XYZ(0, 0, 0);
            const direction = new XYZ(1e-10, 1e-10, 1e-10);

            expect(() => new Ray(point, direction)).toThrow("direction can not be zero");
        });
    });

    describe("direction normalization", () => {
        test("should normalize non-unit direction", () => {
            const ray = new Ray(XYZ.zero, new XYZ(3, 4, 0));
            expect(ray.direction.length()).toBeCloseTo(1);
            expect(ray.direction.x).toBeCloseTo(0.6);
            expect(ray.direction.y).toBeCloseTo(0.8);
            expect(ray.direction.z).toBeCloseTo(0);
        });

        test("should handle negative direction", () => {
            const ray = new Ray(XYZ.zero, new XYZ(-1, 0, 0));
            expect(ray.direction.isEqualTo(new XYZ(-1, 0, 0))).toBe(true);
        });

        test("should handle diagonal direction", () => {
            const ray = new Ray(XYZ.zero, new XYZ(1, 1, 1));
            const expectedLength = 1;
            expect(ray.direction.length()).toBeCloseTo(expectedLength);
        });
    });

    describe("toLine", () => {
        test("should convert to Line with same point and direction", () => {
            const point = new XYZ(1, 2, 3);
            const direction = new XYZ(0, 1, 0);
            const ray = new Ray(point, direction);
            const line = ray.toLine();

            expect(line.point.isEqualTo(ray.point)).toBe(true);
            expect(line.direction.isEqualTo(ray.direction)).toBe(true);
        });

        test("should create Line with normalized direction", () => {
            const ray = new Ray(XYZ.zero, new XYZ(5, 0, 0));
            const line = ray.toLine();

            expect(line.direction.length()).toBeCloseTo(1);
        });
    });

    describe("immutability", () => {
        test("point should be readonly", () => {
            const ray = new Ray(new XYZ(1, 2, 3), XYZ.unitX);
            expect(ray.point).toBeDefined();
        });

        test("direction should be readonly", () => {
            const ray = new Ray(XYZ.zero, XYZ.unitY);
            expect(ray.direction).toBeDefined();
        });
    });
});
