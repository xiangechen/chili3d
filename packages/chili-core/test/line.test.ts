// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, XYZ } from "../src";

describe("test line", () => {
    test("test constructor", () => {
        expect(() => new Line(XYZ.zero, XYZ.zero)).toThrow();
        const line = new Line(XYZ.zero, XYZ.unitX);
        expect(line.point).toStrictEqual(XYZ.zero);
        expect(line.direction).toStrictEqual(XYZ.unitX);
    });

    test("test nearest", () => {
        const r1 = new Line(XYZ.zero, XYZ.unitX);
        expect(r1.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(r1.nearestToPoint(new XYZ(-1, 0, 0))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestToPoint(new XYZ(-1, 1, 0))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestTo(new Line(XYZ.unitZ, XYZ.unitX))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Line(XYZ.unitZ, XYZ.unitZ.reverse()))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Line(XYZ.unitZ, XYZ.unitX.add(XYZ.unitZ)))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestTo(new Line(XYZ.unitZ, XYZ.unitX.add(XYZ.unitZ.reverse())))).toStrictEqual(
            new XYZ(1, 0, 0),
        );
        expect(r1.nearestTo(new Line(new XYZ(0.5, -0.5, 0), XYZ.unitY))).toStrictEqual(new XYZ(0.5, 0, 0));
    });

    test("test intersect", () => {
        const r1 = new Line(XYZ.zero, XYZ.unitX);
        const r11 = new Line(XYZ.zero, XYZ.unitY);
        const r2 = new Line(XYZ.unitX.add(XYZ.unitY), XYZ.unitY);
        expect(r1.intersect(r2)).toStrictEqual(XYZ.unitX);
        expect(r1.intersect(r11)).toStrictEqual(XYZ.zero);

        const r3 = new Line(XYZ.zero, XYZ.unitX);
        const r4 = new Line(XYZ.unitY, XYZ.unitX);
        expect(r3.intersect(r4)).toBeUndefined();

        const r5 = new Line(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
        const r6 = new Line(new XYZ(2, 1, 0), new XYZ(0, 1, 0));
        expect(r5.intersect(r6)).toStrictEqual(new XYZ(2, 0, 0));
    });

    test("test distanceTo", () => {
        const r1 = new Line(XYZ.zero, XYZ.unitX);
        const r2 = new Line(XYZ.unitX, XYZ.unitY);
        expect(r1.distanceTo(r2)).toBeCloseTo(0);

        const r3 = new Line(XYZ.zero, XYZ.unitX);
        const r4 = new Line(XYZ.unitY, XYZ.unitX);
        expect(r3.distanceTo(r4)).toBeCloseTo(1);

        const r5 = new Line(new XYZ(0, 0, 0), new XYZ(1, 1, 0).normalize()!);
        const r6 = new Line(new XYZ(2, 0, 0), new XYZ(0, 1, 0));
        expect(r5.distanceTo(r6)).toBeCloseTo(0);
    });

    test("test nearestToPoint", () => {
        const line = new Line(XYZ.zero, XYZ.unitX);

        expect(line.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(line.nearestToPoint(XYZ.unitX)).toStrictEqual(XYZ.unitX);

        expect(line.nearestToPoint(new XYZ(0, 1, 0))).toStrictEqual(XYZ.zero);
        expect(line.nearestToPoint(new XYZ(2, 3, 0))).toStrictEqual(new XYZ(2, 0, 0));
    });

    test("test direction normalization", () => {
        const line = new Line(XYZ.zero, new XYZ(2, 0, 0));
        expect(line.direction).toStrictEqual(XYZ.unitX);

        const line2 = new Line(XYZ.zero, new XYZ(3, 4, 0));
        expect(line2.direction.length()).toBeCloseTo(1);
    });
});
