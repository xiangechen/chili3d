// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Ray, XYZ } from "../src";

describe("test ray", () => {
    test("test constructor", () => {
        expect(() => new Ray(XYZ.zero, XYZ.zero)).toThrow();
        const ray = new Ray(XYZ.zero, XYZ.unitX);
        expect(ray.location).toStrictEqual(XYZ.zero);
        expect(ray.direction).toStrictEqual(XYZ.unitX);
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

        const r3 = new Ray(XYZ.zero, XYZ.unitX);
        const r4 = new Ray(XYZ.unitY, XYZ.unitX);
        expect(r3.intersect(r4)).toBeUndefined();

        const r5 = new Ray(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
        const r6 = new Ray(new XYZ(2, 1, 0), new XYZ(0, 1, 0));
        expect(r5.intersect(r6)).toStrictEqual(new XYZ(2, 0, 0));
    });

    test("test distanceTo", () => {
        const r1 = new Ray(XYZ.zero, XYZ.unitX);
        const r2 = new Ray(XYZ.unitX, XYZ.unitY);
        expect(r1.distanceTo(r2)).toBeCloseTo(0);

        const r3 = new Ray(XYZ.zero, XYZ.unitX);
        const r4 = new Ray(XYZ.unitY, XYZ.unitX);
        expect(r3.distanceTo(r4)).toBeCloseTo(1);

        const r5 = new Ray(new XYZ(0, 0, 0), new XYZ(1, 1, 0).normalize()!);
        const r6 = new Ray(new XYZ(2, 0, 0), new XYZ(0, 1, 0));
        expect(r5.distanceTo(r6)).toBeCloseTo(0);
    });

    test("test nearestToPoint", () => {
        const ray = new Ray(XYZ.zero, XYZ.unitX);

        expect(ray.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(ray.nearestToPoint(XYZ.unitX)).toStrictEqual(XYZ.unitX);

        expect(ray.nearestToPoint(new XYZ(0, 1, 0))).toStrictEqual(XYZ.zero);
        expect(ray.nearestToPoint(new XYZ(2, 3, 0))).toStrictEqual(new XYZ(2, 0, 0));
    });

    test("test direction normalization", () => {
        const ray = new Ray(XYZ.zero, new XYZ(2, 0, 0));
        expect(ray.direction).toStrictEqual(XYZ.unitX);

        const ray2 = new Ray(XYZ.zero, new XYZ(3, 4, 0));
        expect(ray2.direction.length()).toBeCloseTo(1);
    });
});
