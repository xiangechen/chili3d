// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { getVectorComponent, Precision, XY, XYZ } from "../src";

describe("XYZ class tests", () => {
    describe("Basic properties and constructor", () => {
        test("should create XYZ instance with given values", () => {
            const point = new XYZ(1, 2, 3);
            expect(point.x).toBe(1);
            expect(point.y).toBe(2);
            expect(point.z).toBe(3);

            expect(XYZ.fromArray(undefined as any)).toEqual(XYZ.zero);
            expect(XYZ.fromArray([1, 2, 3])).toEqual(point);
            expect(XYZ.fromArray([1, 2])).toEqual(new XYZ(1, 2, 0));
            expect(XYZ.fromArray([1, 2, 3, 4])).toEqual(new XYZ(1, 2, 3));
        });

        test("should have correct static properties", () => {
            expect(XYZ.zero).toEqual(new XYZ(0, 0, 0));
            expect(XYZ.unitX).toEqual(new XYZ(1, 0, 0));
            expect(XYZ.unitY).toEqual(new XYZ(0, 1, 0));
            expect(XYZ.unitZ).toEqual(new XYZ(0, 0, 1));
            expect(XYZ.unitNX).toEqual(new XYZ(-1, 0, 0));
            expect(XYZ.unitNY).toEqual(new XYZ(0, -1, 0));
            expect(XYZ.unitNZ).toEqual(new XYZ(0, 0, -1));
            expect(XYZ.one).toEqual(new XYZ(1, 1, 1));
        });

        test("should convert to string and array correctly", () => {
            const point = new XYZ(1, 2, 3);
            expect(point.toString()).toBe("1, 2, 3");
            expect(point.toArray()).toEqual([1, 2, 3]);
        });
    });

    describe("Arithmetic operations", () => {
        test("should add vectors correctly", () => {
            const a = new XYZ(1, 2, 3);
            const b = new XYZ(4, 5, 6);
            const result = a.add(b);
            expect(result).toEqual(new XYZ(5, 7, 9));
        });

        test("should subtract vectors correctly", () => {
            const a = new XYZ(5, 7, 9);
            const b = new XYZ(1, 2, 3);
            const result = a.sub(b);
            expect(result).toEqual(new XYZ(4, 5, 6));
        });

        test("should multiply by scalar correctly", () => {
            const point = new XYZ(1, 2, 3);
            const result = point.multiply(3);
            expect(result).toEqual(new XYZ(3, 6, 9));
        });

        test("should divide by scalar correctly", () => {
            const point = new XYZ(10, 20, 30);
            const result = point.divided(2);
            expect(result).toEqual(new XYZ(5, 10, 15));
        });

        test("should return undefined when dividing by zero", () => {
            const point = new XYZ(10, 20, 30);
            const result = point.divided(0);
            expect(result).toBeUndefined();

            const result2 = point.divided(Precision.Float / 2); // very small number
            expect(result2).toBeUndefined();
        });

        test("should reverse the vector correctly", () => {
            const point = new XYZ(1, 2, 3);
            const reversed = point.reverse();
            expect(reversed).toEqual(new XYZ(-1, -2, -3));

            const zero = XYZ.zero.reverse();
            expect(zero).toEqual(new XYZ(0, 0, 0));
        });
    });

    describe("Mathematical operations", () => {
        test("should calculate cross product correctly", () => {
            const a = new XYZ(1, 0, 0);
            const b = new XYZ(0, 1, 0);
            const result = a.cross(b);
            expect(result).toEqual(new XYZ(0, 0, 1));

            const c = new XYZ(2, 3, 4);
            const d = new XYZ(5, 6, 7);
            const result2 = c.cross(d);
            expect(result2).toEqual(new XYZ(-3, 6, -3)); // (3*7-4*6, 4*5-2*7, 2*6-3*5)
        });

        test("should calculate dot product correctly", () => {
            const a = new XYZ(1, 2, 3);
            const b = new XYZ(4, 5, 6);
            expect(a.dot(b)).toBe(32); // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
        });

        test("should calculate length and length squared correctly", () => {
            const point = new XYZ(3, 4, 5);
            expect(point.lengthSq()).toBe(50); // 9 + 16 + 25
            expect(point.length()).toBe(Math.sqrt(50));
        });

        test("should normalize vector correctly", () => {
            const point = new XYZ(3, 0, 0);
            const normalized = point.normalize();
            expect(normalized).toEqual(new XYZ(1, 0, 0));

            const unit = new XYZ(1, 1, 1);
            const normalized2 = unit.normalize();
            const length = Math.sqrt(3);
            expect(normalized2).toEqual(new XYZ(1 / length, 1 / length, 1 / length));
        });

        test("should return undefined for zero vector normalization", () => {
            const normalized = XYZ.zero.normalize();
            expect(normalized).toBeUndefined();
        });
    });

    describe("Distance and geometric operations", () => {
        test("should calculate distance correctly", () => {
            const a = new XYZ(0, 0, 0);
            const b = new XYZ(3, 4, 0);
            expect(a.distanceTo(b)).toBe(5); // 3-4-5 triangle

            const c = new XYZ(1, 1, 1);
            const d = new XYZ(4, 5, 1);
            expect(c.distanceTo(d)).toBe(5); // 3-4-5 triangle in xy plane
        });

        test("should calculate center correctly", () => {
            const p1 = new XYZ(0, 0, 0);
            const p2 = new XYZ(4, 6, 8);
            const center = XYZ.center(p1, p2);
            expect(center).toEqual(new XYZ(2, 3, 4));
        });
    });

    describe("Angle operations", () => {
        test("should calculate angle correctly", () => {
            const a = new XYZ(10, 0, 0);
            const b = new XYZ(0, 10, 0);
            expect(a.angleTo(b)).toBe(Math.PI / 2);
            expect(a.angleTo(new XYZ(10, 0, 0))).toBe(0);
            expect(a.angleTo(new XYZ(10, 10, 0))).toBe(Math.PI / 4);
            expect(a.angleTo(new XYZ(0, 10, 0))).toBe(Math.PI / 2);
            expect(a.angleTo(new XYZ(-10, 10, 0))).toBe((Math.PI * 3) / 4);
            expect(a.angleTo(new XYZ(-10, 0, 0))).toBe(Math.PI);
            expect(a.angleTo(new XYZ(-10, -10, 0))).toBe((Math.PI * 3) / 4);
            expect(a.angleTo(new XYZ(10, -10, 0))).toBe(Math.PI / 4);
        });

        test("should return undefined for zero vector angle", () => {
            expect(XYZ.zero.angleTo(new XYZ(0, 0, 0))).toBe(undefined);
            expect(XYZ.zero.angleTo(new XYZ(1, 0, 0))).toBeUndefined();
            expect(new XYZ(1, 0, 0).angleTo(XYZ.zero)).toBeUndefined();
        });

        test("should calculate angle on plane correctly", () => {
            const a = new XYZ(10, 0, 0);
            const b = new XYZ(0, 10, 0);
            expect(a.angleOnPlaneTo(b, XYZ.unitZ)).toBe(Math.PI / 2);
            expect(a.angleOnPlaneTo(new XYZ(10, 0, 0), XYZ.unitZ)).toBe(0);
            expect(a.angleOnPlaneTo(new XYZ(10, 10, 0), XYZ.unitZ)).toBe(Math.PI / 4);
            expect(a.angleOnPlaneTo(new XYZ(0, 10, 0), XYZ.unitZ)).toBe(Math.PI / 2);
            expect(a.angleOnPlaneTo(new XYZ(-10, 10, 0), XYZ.unitZ)).toBe((Math.PI * 3) / 4);
            expect(a.angleOnPlaneTo(new XYZ(-10, 0, 0), XYZ.unitZ)).toBe(Math.PI);
            expect(a.angleOnPlaneTo(new XYZ(-10, -10, 0), XYZ.unitZ)).toBe((Math.PI * 5) / 4);
            expect(a.angleOnPlaneTo(new XYZ(10, -10, 0), XYZ.unitZ)).toBe((Math.PI * 7) / 4);

            expect(new XYZ(10, 10, 0).angleOnPlaneTo(a, XYZ.unitZ)).toBe((Math.PI * 7) / 4);
            expect(a.angleOnPlaneTo(new XYZ(10, 10, 0), new XYZ(0, 0, -1))).toBe((Math.PI * 7) / 4);
        });

        test("should return undefined for zero normal in angleOnPlaneTo", () => {
            const a = new XYZ(1, 0, 0);
            const b = new XYZ(0, 1, 0);
            expect(a.angleOnPlaneTo(b, XYZ.zero)).toBeUndefined();
            expect(XYZ.zero.angleOnPlaneTo(XYZ.zero, XYZ.unitZ)).toBe(undefined);
        });
    });

    describe("Rotation operations", () => {
        test("should rotate vector correctly", () => {
            const v = XYZ.unitX.add(XYZ.unitZ);
            expect(v.rotate(v, 90)?.isEqualTo(v)).toBeTruthy();
            expect(
                XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 4)?.isEqualTo(new XYZ(1, 1, 0).normalize()!),
            ).toBeTruthy();
            expect(XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 2)?.isEqualTo(new XYZ(0, 1, 0))).toBeTruthy();
            expect(XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 1)?.isEqualTo(new XYZ(-1, 0, 0))).toBeTruthy();
            expect(XYZ.unitX.rotate(XYZ.unitZ, Math.PI * 1.5)?.isEqualTo(new XYZ(0, -1, 0))).toBeTruthy();

            const result = XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 2);
            expect(result?.isEqualTo(XYZ.unitY, 1e-10)).toBeTruthy();

            const result2 = XYZ.unitY.rotate(XYZ.unitZ, Math.PI / 2);
            expect(result2?.isEqualTo(XYZ.unitX.reverse(), 1e-10)).toBeTruthy();
        });

        test("should handle edge cases for rotation", () => {
            const result = XYZ.unitX.rotate(XYZ.zero, Math.PI / 2);
            expect(result).toBeUndefined();
        });
    });

    describe("Comparison methods", () => {
        test("isEqualTo should work correctly", () => {
            const a = new XYZ(1, 2, 3);
            const b = new XYZ(1, 2, 3);
            expect(a.isEqualTo(b)).toBeTruthy();

            const c = new XYZ(1.1, 2, 3);
            expect(a.isEqualTo(c, 0.2)).toBeTruthy(); // within tolerance
            expect(a.isEqualTo(c, 0.05)).toBeFalsy(); // outside tolerance
        });

        test("isPerpendicularTo should work correctly", () => {
            const a = new XYZ(1, 0, 0);
            const b = new XYZ(0, 1, 0);
            expect(a.isPerpendicularTo(b)).toBeTruthy();
            expect(a.isPerpendicularTo(b.reverse())).toBeTruthy();

            const c = new XYZ(1, 1, 0);
            expect(a.isPerpendicularTo(c, 0.1)).toBeFalsy();
        });

        test("isParallelTo should work correctly", () => {
            const a = new XYZ(1, 0, 0);
            const b = new XYZ(2, 0, 0);
            expect(a.isParallelTo(b)).toBeTruthy();

            const c = new XYZ(-1, 0, 0);
            expect(a.isParallelTo(c)).toBeTruthy(); // opposite direction is still parallel
        });

        test("isOppositeTo should work correctly", () => {
            const a = new XYZ(1, 0, 0);
            const b = new XYZ(-1, 0, 0);
            expect(a.isOppositeTo(b)).toBeTruthy();

            const c = new XYZ(0, 1, 0);
            expect(a.isOppositeTo(c)).toBeFalsy();
        });
    });

    describe("XY class tests", () => {
        test("should calculate angle for XY vectors", () => {
            const v1 = XY.unitX;
            const v2 = XY.unitY;
            expect(v1.angleTo(v2)).toBe(Math.PI / 2);
        });
    });
});

describe("getVectorComponent", () => {
    it("should return the x component when index is 0", () => {
        const point = { x: 1, y: 2, z: 3 };
        expect(getVectorComponent(point, 0)).toBe(1);
    });

    it("should return the y component when index is 1", () => {
        const point = { x: 1, y: 2, z: 3 };
        expect(getVectorComponent(point, 1)).toBe(2);
    });

    it("should return the z component when index is 2", () => {
        const point = { x: 1, y: 2, z: 3 };
        expect(getVectorComponent(point, 2)).toBe(3);
    });

    it("should throw an error when index is out of range", () => {
        const point = { x: 1, y: 2, z: 3 };
        expect(() => getVectorComponent(point, 3)).toThrow("index out of range");
        expect(() => getVectorComponent(point, -1)).toThrow("index out of range");
    });
});
