// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XY } from "../src";

describe("XY class", () => {
    describe("static properties", () => {
        test("should have correct zero", () => {
            expect(XY.zero).toEqual(new XY(0, 0));
        });

        test("should have correct unitX", () => {
            expect(XY.unitX).toEqual(new XY(1, 0));
        });

        test("should have correct unitY", () => {
            expect(XY.unitY).toEqual(new XY(0, 1));
        });
    });

    describe("constructor", () => {
        test("should create XY with given values", () => {
            const xy = new XY(3, 4);
            expect(xy.x).toBe(3);
            expect(xy.y).toBe(4);
        });

        test("should create XY with negative values", () => {
            const xy = new XY(-1, -2);
            expect(xy.x).toBe(-1);
            expect(xy.y).toBe(-2);
        });
    });

    describe("cross", () => {
        test("should calculate cross product correctly", () => {
            const a = new XY(1, 0);
            const b = new XY(0, 1);
            expect(a.cross(b)).toBe(1);
        });

        test("should return negative for reversed order", () => {
            const a = new XY(1, 0);
            const b = new XY(0, 1);
            expect(b.cross(a)).toBe(-1);
        });

        test("should return 0 for parallel vectors", () => {
            const a = new XY(2, 0);
            const b = new XY(3, 0);
            expect(a.cross(b)).toBe(0);
        });
    });

    describe("dot", () => {
        test("should calculate dot product correctly", () => {
            const a = new XY(1, 2);
            const b = new XY(3, 4);
            expect(a.dot(b)).toBe(11);
        });

        test("should return 0 for perpendicular vectors", () => {
            const a = new XY(1, 0);
            const b = new XY(0, 1);
            expect(a.dot(b)).toBe(0);
        });
    });

    describe("divided", () => {
        test("should divide by scalar", () => {
            const xy = new XY(4, 6);
            const result = xy.divided(2);
            expect(result).toEqual(new XY(2, 3));
        });

        test("should return undefined for zero divisor", () => {
            const xy = new XY(4, 6);
            expect(xy.divided(0)).toBeUndefined();
        });

        test("should return undefined for very small divisor", () => {
            const xy = new XY(4, 6);
            expect(xy.divided(1e-10)).toBeUndefined();
        });
    });

    describe("reverse", () => {
        test("should reverse vector", () => {
            const xy = new XY(3, 4);
            expect(xy.reverse()).toEqual(new XY(-3, -4));
        });

        test("should handle zero vector", () => {
            const reversed = XY.zero.reverse();
            expect(reversed.x + 0).toBe(0);
            expect(reversed.y + 0).toBe(0);
        });
    });

    describe("multiply", () => {
        test("should multiply by scalar", () => {
            const xy = new XY(2, 3);
            expect(xy.multiply(3)).toEqual(new XY(6, 9));
        });

        test("should handle negative scalar", () => {
            const xy = new XY(2, 3);
            expect(xy.multiply(-1)).toEqual(new XY(-2, -3));
        });
    });

    describe("sub", () => {
        test("should subtract vectors", () => {
            const a = new XY(5, 7);
            const b = new XY(2, 3);
            expect(a.sub(b)).toEqual(new XY(3, 4));
        });
    });

    describe("add", () => {
        test("should add vectors", () => {
            const a = new XY(1, 2);
            const b = new XY(3, 4);
            expect(a.add(b)).toEqual(new XY(4, 6));
        });
    });

    describe("normalize", () => {
        test("should normalize vector", () => {
            const xy = new XY(3, 4);
            const normalized = xy.normalize();
            expect(normalized?.x).toBeCloseTo(0.6);
            expect(normalized?.y).toBeCloseTo(0.8);
            expect(normalized?.length()).toBeCloseTo(1);
        });

        test("should return undefined for zero vector", () => {
            expect(XY.zero.normalize()).toBeUndefined();
        });

        test("should return undefined for very small vector", () => {
            const xy = new XY(1e-10, 1e-10);
            expect(xy.normalize()).toBeUndefined();
        });
    });

    describe("distanceTo", () => {
        test("should calculate distance correctly", () => {
            const a = new XY(0, 0);
            const b = new XY(3, 4);
            expect(a.distanceTo(b)).toBe(5);
        });

        test("should return 0 for same point", () => {
            const xy = new XY(3, 4);
            expect(xy.distanceTo(xy)).toBe(0);
        });
    });

    describe("center", () => {
        test("should calculate center correctly", () => {
            const a = new XY(0, 0);
            const b = new XY(4, 6);
            expect(XY.center(a, b)).toEqual(new XY(2, 3));
        });
    });

    describe("lengthSq and length", () => {
        test("should calculate length squared", () => {
            const xy = new XY(3, 4);
            expect(xy.lengthSq()).toBe(25);
        });

        test("should calculate length", () => {
            const xy = new XY(3, 4);
            expect(xy.length()).toBe(5);
        });
    });

    describe("angleTo", () => {
        test("should calculate angle between vectors", () => {
            const a = new XY(1, 0);
            const b = new XY(0, 1);
            expect(a.angleTo(b)).toBeCloseTo(Math.PI / 2);
        });

        test("should return 0 for same direction", () => {
            const a = new XY(1, 0);
            const b = new XY(2, 0);
            expect(a.angleTo(b)).toBeCloseTo(0);
        });

        test("should return PI for opposite direction", () => {
            const a = new XY(1, 0);
            const b = new XY(-1, 0);
            expect(a.angleTo(b)).toBeCloseTo(Math.PI);
        });

        test("should return undefined for zero vector", () => {
            expect(XY.zero.angleTo(new XY(1, 0))).toBeUndefined();
            expect(new XY(1, 0).angleTo(XY.zero)).toBeUndefined();
        });
    });

    describe("isEqualTo", () => {
        test("should return true for equal vectors", () => {
            const a = new XY(1, 2);
            const b = new XY(1, 2);
            expect(a.isEqualTo(b)).toBe(true);
        });

        test("should return false for different vectors", () => {
            const a = new XY(1, 2);
            const b = new XY(1, 3);
            expect(a.isEqualTo(b)).toBe(false);
        });

        test("should respect tolerance", () => {
            const a = new XY(1, 2);
            const b = new XY(1.00001, 2.00001);
            expect(a.isEqualTo(b, 0.0001)).toBe(true);
            expect(a.isEqualTo(b, 1e-10)).toBe(false);
        });
    });

    describe("isParallelTo", () => {
        test("should return true for parallel vectors", () => {
            const a = new XY(1, 0);
            const b = new XY(2, 0);
            expect(a.isParallelTo(b)).toBe(true);
        });

        test("should return true for opposite vectors", () => {
            const a = new XY(1, 0);
            const b = new XY(-1, 0);
            expect(a.isParallelTo(b)).toBe(true);
        });

        test("should return false for non-parallel vectors", () => {
            const a = new XY(1, 0);
            const b = new XY(1, 1);
            expect(a.isParallelTo(b)).toBe(false);
        });

        test("should return undefined for zero vector", () => {
            expect(XY.zero.isParallelTo(new XY(1, 0))).toBeUndefined();
        });
    });

    describe("isOppositeTo", () => {
        test("should return true for opposite vectors", () => {
            const a = new XY(1, 0);
            const b = new XY(-1, 0);
            expect(a.isOppositeTo(b)).toBe(true);
        });

        test("should return false for same direction", () => {
            const a = new XY(1, 0);
            const b = new XY(2, 0);
            expect(a.isOppositeTo(b)).toBe(false);
        });

        test("should return undefined for zero vector", () => {
            expect(XY.zero.isOppositeTo(new XY(1, 0))).toBeUndefined();
        });
    });
});
