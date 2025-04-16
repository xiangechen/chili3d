// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Ray, XYZ } from "../src";

describe("test ray", () => {
    test("test constructor", () => {
        expect(() => new Ray(XYZ.zero, XYZ.zero)).toThrow();
    });

    test("test nearest", () => {
        let r1 = new Ray(XYZ.zero, XYZ.unitX);
        expect(r1.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(r1.nearestToPoint(new XYZ(-1, 0, 0))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestToPoint(new XYZ(-1, 1, 0))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitX))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitZ.reverse()))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitX.add(XYZ.unitZ)))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitX.add(XYZ.unitZ.reverse())))).toStrictEqual(
            new XYZ(1, 0, 0),
        );
        expect(r1.nearestTo(new Ray(new XYZ(0.5, -0.5, 0), XYZ.unitY))).toStrictEqual(new XYZ(0.5, 0, 0));
    });

    test("test intersect", () => {
        let r1 = new Ray(XYZ.zero, XYZ.unitX);
        let r2 = new Ray(XYZ.unitX.add(XYZ.unitY), XYZ.unitY);
        expect(r1.intersect(r2)).toStrictEqual(XYZ.unitX);
    });
});
