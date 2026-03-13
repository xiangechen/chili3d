// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Plane, Ray, XYZ } from "../src";

describe("test plane", () => {
    test("test constructor", () => {
        expect(() => new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitX })).toThrow();
        expect(() => new Plane({ origin: XYZ.zero, normal: XYZ.zero, xvec: XYZ.unitY })).toThrow();
        expect(() => new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.zero })).toThrow();
    });

    test("test intersect", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        expect(plane.intersectLine(new Line({ point: XYZ.unitZ, direction: XYZ.unitX }))).toBeUndefined();
        expect(
            plane.intersectLine(new Line({ point: XYZ.unitZ, direction: XYZ.unitZ.reverse() })),
        ).toStrictEqual(XYZ.zero);
        expect(
            plane.intersectLine(new Line({ point: XYZ.unitX, direction: XYZ.unitZ.add(XYZ.unitX) })),
        ).toStrictEqual(XYZ.unitX);
        expect(
            plane.intersectLine(
                new Line({
                    point: new XYZ({ x: 1, y: 1, z: 1 }),
                    direction: new XYZ({ x: -1, y: 0, z: -1 }),
                }),
            ),
        ).toStrictEqual(new XYZ({ x: 0, y: 1, z: 0 }));
        expect(
            plane.intersectLine(
                new Line({ point: new XYZ({ x: 1, y: 1, z: 1 }), direction: new XYZ({ x: 1, y: 0, z: 1 }) }),
            ),
        ).toStrictEqual(new XYZ({ x: 0, y: 1, z: 0 }));
        expect(
            plane.intersectRay(
                new Ray({ point: new XYZ({ x: 1, y: 1, z: 1 }), direction: new XYZ({ x: 1, y: 0, z: 1 }) }),
            ),
        ).toBeUndefined();
    });

    test("test project", () => {
        expect(Plane.XY.project(new XYZ({ x: 0, y: 0, z: 0 }))).toStrictEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(Plane.XY.project(new XYZ({ x: 100, y: 100, z: 100 }))).toStrictEqual(
            new XYZ({ x: 100, y: 100, z: 0 }),
        );
    });
});
