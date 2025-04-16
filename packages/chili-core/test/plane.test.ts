// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Ray, XYZ } from "../src";

describe("test plane", () => {
    test("test constructor", () => {
        expect(() => new Plane(XYZ.zero, XYZ.unitX, XYZ.unitX)).toThrow();
        expect(() => new Plane(XYZ.zero, XYZ.zero, XYZ.unitY)).toThrow();
        expect(() => new Plane(XYZ.zero, XYZ.unitX, XYZ.zero)).toThrow();
    });

    test("test intersect", () => {
        let plane = new Plane(XYZ.zero, XYZ.unitZ, XYZ.unitX);
        expect(plane.intersect(new Ray(XYZ.unitZ, XYZ.unitX))).toBeUndefined();
        expect(plane.intersect(new Ray(XYZ.unitZ, XYZ.unitZ.reverse()))).toStrictEqual(XYZ.zero);
        expect(plane.intersect(new Ray(XYZ.unitX, XYZ.unitZ.add(XYZ.unitX)))).toStrictEqual(XYZ.unitX);
        expect(plane.intersect(new Ray(new XYZ(1, 1, 1), new XYZ(-1, 0, -1)))).toStrictEqual(
            new XYZ(0, 1, 0),
        );
        expect(plane.intersect(new Ray(new XYZ(1, 1, 1), new XYZ(1, 0, 1)))).toStrictEqual(new XYZ(0, 1, 0));
        expect(plane.intersect(new Ray(new XYZ(1, 1, 1), new XYZ(1, 0, 1)), false)).toBeUndefined();
    });

    test("test project", () => {
        expect(Plane.XY.project(new XYZ(0, 0, 0))).toStrictEqual(new XYZ(0, 0, 0));
        expect(Plane.XY.project(new XYZ(100, 100, 100))).toStrictEqual(new XYZ(100, 100, 0));
    });
});
