// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, PlaneAngle, XYZ } from "../src";

describe("PlaneAngle", () => {
    describe("constructor", () => {
        test("should create with plane", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);
            expect(planeAngle.plane).toBe(plane);
            expect(planeAngle.angle).toBe(0);
        });
    });

    describe("initial state", () => {
        test("should have angle 0 initially", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);
            expect(planeAngle.angle).toBe(0);
        });
    });

    describe("movePoint", () => {
        test("should calculate angle on XY plane", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(1, 0, 0));
            expect(planeAngle.angle).toBeCloseTo(0);
        });

        test("should calculate 90 degree angle", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(0, 1, 0));
            expect(planeAngle.angle).toBeCloseTo(90);
        });

        test("should calculate 180 degree angle", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(-1, 0, 0));
            expect(planeAngle.angle).toBeCloseTo(180);
        });

        test("should calculate 270 degree angle", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(0, -1, 0));
            expect(planeAngle.angle).toBeCloseTo(270);
        });

        test("should calculate 45 degree angle", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(1, 1, 0));
            expect(planeAngle.angle).toBeCloseTo(45);
        });

        test("should handle continuous rotation crossing positive X axis", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(1, 0.1, 0));
            planeAngle.movePoint(new XYZ(1, -0.1, 0));

            expect(planeAngle.angle).toBeLessThan(0);
        });
    });

    describe("angle tracking", () => {
        test("should update angle on each movePoint", () => {
            const plane = Plane.XY;
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(1, 0, 0));
            const angle1 = planeAngle.angle;

            planeAngle.movePoint(new XYZ(0, 1, 0));
            const angle2 = planeAngle.angle;

            expect(angle2).not.toBe(angle1);
            expect(angle2).toBeCloseTo(90);
        });
    });

    describe("plane with offset origin", () => {
        test("should handle plane with non-zero origin", () => {
            const plane = new Plane(new XYZ(5, 5, 0), XYZ.unitZ, XYZ.unitX);
            const planeAngle = new PlaneAngle(plane);

            planeAngle.movePoint(new XYZ(6, 5, 0));
            expect(planeAngle.angle).toBeCloseTo(0);

            planeAngle.movePoint(new XYZ(5, 6, 0));
            expect(planeAngle.angle).toBeCloseTo(90);
        });
    });
});
