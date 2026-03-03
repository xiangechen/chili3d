// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Plane, Ray, XYZ } from "../src";

describe("test plane", () => {
    test("test constructor", () => {
        expect(() => new Plane(XYZ.zero, XYZ.unitX, XYZ.unitX)).toThrow();
        expect(() => new Plane(XYZ.zero, XYZ.zero, XYZ.unitY)).toThrow();
        expect(() => new Plane(XYZ.zero, XYZ.unitX, XYZ.zero)).toThrow();
    });

    test("test intersect", () => {
        const plane = new Plane(XYZ.zero, XYZ.unitZ, XYZ.unitX);
        expect(plane.intersectLine(new Line(XYZ.unitZ, XYZ.unitX))).toBeUndefined();
        expect(plane.intersectLine(new Line(XYZ.unitZ, XYZ.unitZ.reverse()))).toStrictEqual(XYZ.zero);
        expect(plane.intersectLine(new Line(XYZ.unitX, XYZ.unitZ.add(XYZ.unitX)))).toStrictEqual(XYZ.unitX);
        expect(plane.intersectLine(new Line(new XYZ(1, 1, 1), new XYZ(-1, 0, -1)))).toStrictEqual(
            new XYZ(0, 1, 0),
        );
        expect(plane.intersectLine(new Line(new XYZ(1, 1, 1), new XYZ(1, 0, 1)))).toStrictEqual(
            new XYZ(0, 1, 0),
        );
        expect(plane.intersectRay(new Ray(new XYZ(1, 1, 1), new XYZ(1, 0, 1)))).toBeUndefined();
    });

    test("test project", () => {
        expect(Plane.XY.project(new XYZ(0, 0, 0))).toStrictEqual(new XYZ(0, 0, 0));
        expect(Plane.XY.project(new XYZ(100, 100, 100))).toStrictEqual(new XYZ(100, 100, 0));
    });
});
