// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Matrix4, Plane, Ray, XYZ } from "../src";

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

    test("test static planes", () => {
        expect(Plane.XY.origin.isEqualTo(XYZ.zero)).toBeTruthy();
        expect(Plane.XY.normal.isEqualTo(XYZ.unitZ)).toBeTruthy();
        expect(Plane.YZ.normal.isEqualTo(XYZ.unitX)).toBeTruthy();
        expect(Plane.ZX.normal.isEqualTo(XYZ.unitY)).toBeTruthy();
    });

    test("test translateTo", () => {
        const plane = Plane.XY;
        const newOrigin = new XYZ({ x: 10, y: 20, z: 30 });
        const translated = plane.translateTo(newOrigin);
        expect(translated.origin.isEqualTo(newOrigin)).toBeTruthy();
        // Normal and xvec should stay the same
        expect(translated.normal.isEqualTo(plane.normal)).toBeTruthy();
        expect(translated.xvec.isEqualTo(plane.xvec)).toBeTruthy();

        // Project should work on the translated plane
        const point = new XYZ({ x: 5, y: 5, z: 100 });
        const proj = translated.project(point);
        expect(proj.z).toBeCloseTo(30);
    });

    test("test transformed", () => {
        const plane = Plane.XY;
        const matrix = Matrix4.fromTranslation(1, 2, 3);
        const transformed = plane.transformed(matrix);
        expect(transformed.origin.isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBeTruthy();
        // Normal should still be unitZ after translation
        expect(transformed.normal.isEqualTo(XYZ.unitZ)).toBeTruthy();
    });

    test("test intersectLine with line point on plane", () => {
        // Line starts exactly on the plane — vec.isEqualTo(XYZ.zero)
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const line = new Line({ point: XYZ.zero, direction: XYZ.unitX.add(XYZ.unitZ) });
        const result = plane.intersectLine(line);
        expect(result).toBeDefined();
        expect(result!.isEqualTo(XYZ.zero)).toBeTruthy();
    });

    test("test intersectLine with line parallel to plane (same point)", () => {
        // Line on the plane, direction parallel to plane
        const plane = new Plane({ origin: XYZ.unitZ, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const line = new Line({ point: XYZ.unitZ, direction: XYZ.unitX });
        const result = plane.intersectLine(line);
        expect(result!.isEqualTo(XYZ.unitZ)).toBeTruthy();
    });

    test("test intersectRay with ray hitting plane from above", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const ray = new Ray({
            point: new XYZ({ x: 0, y: 0, z: 10 }),
            direction: XYZ.unitNZ,
        });
        const result = plane.intersectRay(ray);
        expect(result).toBeDefined();
        expect(result!.isEqualTo(XYZ.zero)).toBeTruthy();
    });

    test("test intersectRay with ray pointing away", () => {
        const plane = new Plane({ origin: XYZ.unitZ, normal: XYZ.unitZ, xvec: XYZ.unitX });
        // Ray starts behind the plane and points away
        const ray = new Ray({
            point: new XYZ({ x: 0, y: 0, z: 0 }),
            direction: XYZ.unitNZ,
        });
        const result = plane.intersectRay(ray);
        expect(result).toBeUndefined();
    });

    test("test projectDistance", () => {
        const plane = Plane.XY;
        const p1 = new XYZ({ x: 0, y: 0, z: 10 });
        const p2 = new XYZ({ x: 3, y: 4, z: 20 });
        const dist = plane.projectDistance(p1, p2);
        // Both project to z=0, so distance on plane = 5
        expect(dist).toBeCloseTo(5);
    });

    test("test project on YZ plane", () => {
        const point = new XYZ({ x: 100, y: 50, z: 25 });
        const proj = Plane.YZ.project(point);
        expect(proj.x).toBeCloseTo(0);
        expect(proj.y).toBeCloseTo(50);
        expect(proj.z).toBeCloseTo(25);
    });

    test("test project on ZX plane", () => {
        const point = new XYZ({ x: 100, y: 50, z: 25 });
        const proj = Plane.ZX.project(point);
        expect(proj.x).toBeCloseTo(100);
        expect(proj.y).toBeCloseTo(0);
        expect(proj.z).toBeCloseTo(25);
    });
});
