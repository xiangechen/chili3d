// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XY, XYZ } from "../src";

describe("test xyz", () => {
    test("test xyz", () => {
        let a = new XYZ(10, 0, 0);
        let b = new XYZ(0, 10, 0);
        expect(a.add(b)).toStrictEqual(new XYZ(10, 10, 0));

        expect(XYZ.center(a, b)).toStrictEqual(new XYZ(5, 5, 0));
        expect(a.cross(b)).toStrictEqual(new XYZ(0, 0, 100));
        expect(a.distanceTo(b)).toBe(Math.sqrt(200));
        expect(a.divided(0.5)).toStrictEqual(new XYZ(20, 0, 0));
        expect(a.dot(b)).toBe(0);
        expect(a.multiply(2)).toStrictEqual(new XYZ(20, 0, 0));
        expect(a.normalize()).toStrictEqual(new XYZ(1, 0, 0));
        expect(a.sub(b)).toStrictEqual(new XYZ(10, -10, 0));
    });

    test("test angle", () => {
        let a = new XYZ(10, 0, 0);
        let b = new XYZ(0, 10, 0);
        expect(XYZ.zero.angleTo(new XYZ(0, 0, 0))).toBe(undefined);
        expect(a.angleTo(b)).toBe(Math.PI / 2);
        expect(a.angleTo(new XYZ(10, 0, 0))).toBe(0);
        expect(a.angleTo(new XYZ(10, 10, 0))).toBe(Math.PI / 4);
        expect(a.angleTo(new XYZ(0, 10, 0))).toBe(Math.PI / 2);
        expect(a.angleTo(new XYZ(-10, 10, 0))).toBe((Math.PI * 3) / 4);
        expect(a.angleTo(new XYZ(-10, 0, 0))).toBe(Math.PI);
        expect(a.angleTo(new XYZ(-10, -10, 0))).toBe((Math.PI * 3) / 4);
        expect(a.angleTo(new XYZ(10, -10, 0))).toBe(Math.PI / 4);

        expect(XYZ.zero.angleOnPlaneTo(XYZ.zero, XYZ.unitZ)).toBe(undefined);
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

    test("test xy", () => {
        let v1 = XY.unitX;
        let v2 = XY.unitY;
        expect(v1.angleTo(v2)).toBe(Math.PI / 2);
    });

    test("test rotate", () => {
        let v = XYZ.unitX.add(XYZ.unitZ);
        expect(v.rotate(v, 90)?.isEqualTo(v)).toBeTruthy();
        expect(
            XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 4)?.isEqualTo(new XYZ(1, 1, 0).normalize()!),
        ).toBeTruthy();
        expect(XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 2)?.isEqualTo(new XYZ(0, 1, 0))).toBeTruthy();
        expect(XYZ.unitX.rotate(XYZ.unitZ, Math.PI / 1)?.isEqualTo(new XYZ(-1, 0, 0))).toBeTruthy();
        expect(XYZ.unitX.rotate(XYZ.unitZ, Math.PI * 1.5)?.isEqualTo(new XYZ(0, -1, 0))).toBeTruthy();
    });
});
