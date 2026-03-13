// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, XYZ } from "../src";

describe("test line", () => {
    test("test constructor", () => {
        expect(() => new Line({ point: XYZ.zero, direction: XYZ.zero })).toThrow();
        const line = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        expect(line.point).toStrictEqual(XYZ.zero);
        expect(line.direction).toStrictEqual(XYZ.unitX);
    });

    test("test nearest", () => {
        const r1 = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        expect(r1.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(r1.nearestToPoint(new XYZ({ x: -1, y: 0, z: 0 }))).toStrictEqual(
            new XYZ({ x: -1, y: 0, z: 0 }),
        );
        expect(r1.nearestToPoint(new XYZ({ x: -1, y: 1, z: 0 }))).toStrictEqual(
            new XYZ({ x: -1, y: 0, z: 0 }),
        );
        expect(r1.nearestTo(new Line({ point: XYZ.unitZ, direction: XYZ.unitX }))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Line({ point: XYZ.unitZ, direction: XYZ.unitZ.reverse() }))).toStrictEqual(
            XYZ.zero,
        );
        expect(
            r1.nearestTo(new Line({ point: XYZ.unitZ, direction: XYZ.unitX.add(XYZ.unitZ) })),
        ).toStrictEqual(new XYZ({ x: -1, y: 0, z: 0 }));
        expect(
            r1.nearestTo(new Line({ point: XYZ.unitZ, direction: XYZ.unitX.add(XYZ.unitZ.reverse()) })),
        ).toStrictEqual(new XYZ({ x: 1, y: 0, z: 0 }));
        expect(
            r1.nearestTo(new Line({ point: new XYZ({ x: 0.5, y: -0.5, z: 0 }), direction: XYZ.unitY })),
        ).toStrictEqual(new XYZ({ x: 0.5, y: 0, z: 0 }));
    });

    test("test intersect", () => {
        const r1 = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const r11 = new Line({ point: XYZ.zero, direction: XYZ.unitY });
        const r2 = new Line({ point: XYZ.unitX.add(XYZ.unitY), direction: XYZ.unitY });
        expect(r1.intersect(r2)).toStrictEqual(XYZ.unitX);
        expect(r1.intersect(r11)).toStrictEqual(XYZ.zero);

        const r3 = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const r4 = new Line({ point: XYZ.unitY, direction: XYZ.unitX });
        expect(r3.intersect(r4)).toBeUndefined();

        const r5 = new Line({
            point: new XYZ({ x: 0, y: 0, z: 0 }),
            direction: new XYZ({ x: 1, y: 0, z: 0 }),
        });
        const r6 = new Line({
            point: new XYZ({ x: 2, y: 1, z: 0 }),
            direction: new XYZ({ x: 0, y: 1, z: 0 }),
        });
        expect(r5.intersect(r6)).toStrictEqual(new XYZ({ x: 2, y: 0, z: 0 }));
    });

    test("test distanceTo", () => {
        const r1 = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const r2 = new Line({ point: XYZ.unitX, direction: XYZ.unitY });
        expect(r1.distanceTo(r2)).toBeCloseTo(0);

        const r3 = new Line({ point: XYZ.zero, direction: XYZ.unitX });
        const r4 = new Line({ point: XYZ.unitY, direction: XYZ.unitX });
        expect(r3.distanceTo(r4)).toBeCloseTo(1);

        const r5 = new Line({
            point: new XYZ({ x: 0, y: 0, z: 0 }),
            direction: new XYZ({ x: 1, y: 1, z: 0 }).normalize()!,
        });
        const r6 = new Line({
            point: new XYZ({ x: 2, y: 0, z: 0 }),
            direction: new XYZ({ x: 0, y: 1, z: 0 }),
        });
        expect(r5.distanceTo(r6)).toBeCloseTo(0);
    });

    test("test nearestToPoint", () => {
        const line = new Line({ point: XYZ.zero, direction: XYZ.unitX });

        expect(line.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(line.nearestToPoint(XYZ.unitX)).toStrictEqual(XYZ.unitX);

        expect(line.nearestToPoint(new XYZ({ x: 0, y: 1, z: 0 }))).toStrictEqual(XYZ.zero);
        expect(line.nearestToPoint(new XYZ({ x: 2, y: 3, z: 0 }))).toStrictEqual(
            new XYZ({ x: 2, y: 0, z: 0 }),
        );
    });

    test("test direction normalization", () => {
        const line = new Line({ point: XYZ.zero, direction: new XYZ({ x: 2, y: 0, z: 0 }) });
        expect(line.direction).toStrictEqual(XYZ.unitX);

        const line2 = new Line({ point: XYZ.zero, direction: new XYZ({ x: 3, y: 4, z: 0 }) });
        expect(line2.direction.length()).toBeCloseTo(1);
    });
});
