// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, XYZ } from "../src";
import { type Dimension, Dimensions, DimensionUtils } from "../src/snap/dimension";
import { Axis } from "../src/snap/tracking/axis";

// ============================================================================
// DimensionUtils
// ============================================================================

describe("DimensionUtils", () => {
    describe("contains", () => {
        test("should return true when d1 fully contains d2", () => {
            expect(DimensionUtils.contains(Dimensions.D1D2, Dimensions.D1)).toBe(true);
            expect(DimensionUtils.contains(Dimensions.D1D2, Dimensions.D2)).toBe(true);
            expect(DimensionUtils.contains(Dimensions.D1D2D3, Dimensions.D1)).toBe(true);
            expect(DimensionUtils.contains(Dimensions.D1D2D3, Dimensions.D3)).toBe(true);
            expect(DimensionUtils.contains(Dimensions.D1D2D3, Dimensions.D1D2)).toBe(true);
        });

        test("should return false when d2 is None", () => {
            expect(DimensionUtils.contains(Dimensions.D1, Dimensions.None)).toBe(false);
            expect(DimensionUtils.contains(Dimensions.D1D2D3, Dimensions.None)).toBe(false);
        });

        test("should return false when d1 does not contain d2", () => {
            expect(DimensionUtils.contains(Dimensions.D1, Dimensions.D2)).toBe(false);
            expect(DimensionUtils.contains(Dimensions.D1, Dimensions.D3)).toBe(false);
            expect(DimensionUtils.contains(Dimensions.D1D2, Dimensions.D3)).toBe(false);
        });
    });

    describe("from", () => {
        test("should return D1 for value 1", () => {
            expect(DimensionUtils.from(1)).toBe(Dimensions.D1);
        });

        test("should return D2 for value 2", () => {
            expect(DimensionUtils.from(2)).toBe(Dimensions.D2);
        });

        test("should return D3 for value 3", () => {
            expect(DimensionUtils.from(3)).toBe(Dimensions.D3);
        });

        test("should return None for unsupported values", () => {
            expect(DimensionUtils.from(0)).toBe(Dimensions.None);
            expect(DimensionUtils.from(4)).toBe(Dimensions.None);
            expect(DimensionUtils.from(999)).toBe(Dimensions.None);
            expect(DimensionUtils.from(-1)).toBe(Dimensions.None);
        });
    });
});

// ============================================================================
// Axis
// ============================================================================

describe("Axis", () => {
    describe("constructor", () => {
        test("should create an Axis with location, direction, and name", () => {
            const origin = XYZ.zero;
            const dir = XYZ.unitX;
            const axis = new Axis(origin, dir, "X Axis");

            expect(axis.point).toBe(origin);
            expect(axis.direction).toStrictEqual(dir);
            expect(axis.name).toBe("X Axis");
        });

        test("should normalize the direction", () => {
            const axis = new Axis(XYZ.zero, new XYZ({ x: 2, y: 0, z: 0 }), "test");
            expect(axis.direction.isEqualTo(XYZ.unitX)).toBe(true);
        });
    });

    describe("getAxiesAtPlane", () => {
        test("should return x and y axes when containsZ is false", () => {
            const plane = Plane.XY;
            const origin = XYZ.zero;
            const axes = Axis.getAxiesAtPlane(origin, plane, false);

            expect(axes.length).toBe(4); // x, -x, y, -y
            expect(axes[0].name).toBe("axis.x");
            expect(axes[0].direction.isEqualTo(plane.xvec)).toBe(true);
            expect(axes[1].name).toBe("axis.x");
            expect(axes[1].direction.isEqualTo(plane.xvec.reverse())).toBe(true);
            expect(axes[2].name).toBe("axis.y");
            expect(axes[2].direction.isEqualTo(plane.yvec)).toBe(true);
            expect(axes[3].name).toBe("axis.y");
            expect(axes[3].direction.isEqualTo(plane.yvec.reverse())).toBe(true);

            // All axes should have the same origin
            axes.forEach((a) => expect(a.point).toBe(origin));
        });

        test("should return x, y and z axes when containsZ is true", () => {
            const plane = Plane.XY;
            const origin = new XYZ({ x: 1, y: 2, z: 3 });
            const axes = Axis.getAxiesAtPlane(origin, plane, true);

            expect(axes.length).toBe(6); // x, -x, y, -y, z, -z
            const zAxes = axes.filter((a) => a.name === "axis.z");
            expect(zAxes.length).toBe(2);
            expect(zAxes[0].direction.isEqualTo(plane.normal)).toBe(true);
            expect(zAxes[1].direction.isEqualTo(plane.normal.reverse())).toBe(true);

            // All axes should have the same origin
            axes.forEach((a) => expect(a.point).toBe(origin));
        });
    });
});
