// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Line, Matrix4, Plane, Ray, XYZ } from "../src";

describe("Plane", () => {
    test("should reject invalid plane parameters", () => {
        expect(() => new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitX })).toThrow();
        expect(() => new Plane({ origin: XYZ.zero, normal: XYZ.zero, xvec: XYZ.unitY })).toThrow();
        expect(() => new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.zero })).toThrow();
    });

    test("should compute intersection of plane with line and ray", () => {
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

    test("should project point onto plane", () => {
        expect(Plane.XY.project(new XYZ({ x: 0, y: 0, z: 0 }))).toStrictEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(Plane.XY.project(new XYZ({ x: 100, y: 100, z: 100 }))).toStrictEqual(
            new XYZ({ x: 100, y: 100, z: 0 }),
        );
    });

    test("should define static XY, YZ and ZX planes", () => {
        expect(Plane.XY.origin.isEqualTo(XYZ.zero)).toBe(true);
        expect(Plane.XY.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(Plane.YZ.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(Plane.ZX.normal.isEqualTo(XYZ.unitY)).toBe(true);
    });

    test("should translate plane to a new origin", () => {
        const plane = Plane.XY;
        const newOrigin = new XYZ({ x: 10, y: 20, z: 30 });
        const translated = plane.translateTo(newOrigin);
        expect(translated.origin.isEqualTo(newOrigin)).toBe(true);
        // Normal and xvec should stay the same
        expect(translated.normal.isEqualTo(plane.normal)).toBe(true);
        expect(translated.xvec.isEqualTo(plane.xvec)).toBe(true);

        // Project should work on the translated plane
        const point = new XYZ({ x: 5, y: 5, z: 100 });
        const proj = translated.project(point);
        expect(proj.z).toBeCloseTo(30);
    });

    test("should transform plane by a matrix", () => {
        const plane = Plane.XY;
        const matrix = Matrix4.fromTranslation(1, 2, 3);
        const transformed = plane.transformed(matrix);
        expect(transformed.origin.isEqualTo(new XYZ({ x: 1, y: 2, z: 3 }))).toBe(true);
        // Normal should still be unitZ after translation
        expect(transformed.normal.isEqualTo(XYZ.unitZ)).toBe(true);
    });

    test("should return the line point when it lies on the plane", () => {
        // Line starts exactly on the plane — vec.isEqualTo(XYZ.zero)
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const line = new Line({ point: XYZ.zero, direction: XYZ.unitX.add(XYZ.unitZ) });
        const result = plane.intersectLine(line);
        expect(result).not.toBeNull();
        expect(result!.isEqualTo(XYZ.zero)).toBe(true);
    });

    test("should return the line point for a line lying on the plane", () => {
        // Line on the plane, direction parallel to plane
        const plane = new Plane({ origin: XYZ.unitZ, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const line = new Line({ point: XYZ.unitZ, direction: XYZ.unitX });
        const result = plane.intersectLine(line);
        expect(result!.isEqualTo(XYZ.unitZ)).toBe(true);
    });

    test("should intersect ray hitting the plane from above", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const ray = new Ray({
            point: new XYZ({ x: 0, y: 0, z: 10 }),
            direction: XYZ.unitNZ,
        });
        const result = plane.intersectRay(ray);
        expect(result).not.toBeNull();
        expect(result!.isEqualTo(XYZ.zero)).toBe(true);
    });

    test("should return undefined when ray points away from the plane", () => {
        const plane = new Plane({ origin: XYZ.unitZ, normal: XYZ.unitZ, xvec: XYZ.unitX });
        // Ray starts behind the plane and points away
        const ray = new Ray({
            point: new XYZ({ x: 0, y: 0, z: 0 }),
            direction: XYZ.unitNZ,
        });
        const result = plane.intersectRay(ray);
        expect(result).toBeUndefined();
    });

    test("should compute distance between projected points", () => {
        const plane = Plane.XY;
        const p1 = new XYZ({ x: 0, y: 0, z: 10 });
        const p2 = new XYZ({ x: 3, y: 4, z: 20 });
        const dist = plane.projectDistance(p1, p2);
        // Both project to z=0, so distance on plane = 5
        expect(dist).toBeCloseTo(5);
    });

    test("should project point onto YZ plane", () => {
        const point = new XYZ({ x: 100, y: 50, z: 25 });
        const proj = Plane.YZ.project(point);
        expect(proj.x).toBeCloseTo(0);
        expect(proj.y).toBeCloseTo(50);
        expect(proj.z).toBeCloseTo(25);
    });

    test("should project point onto ZX plane", () => {
        const point = new XYZ({ x: 100, y: 50, z: 25 });
        const proj = Plane.ZX.project(point);
        expect(proj.x).toBeCloseTo(100);
        expect(proj.y).toBeCloseTo(0);
        expect(proj.z).toBeCloseTo(25);
    });

    describe("offsetAlongNormal", () => {
        test("moves the origin along the normal and keeps the frame", () => {
            const plane = Plane.XY.offsetAlongNormal(25);
            expect(plane.origin.z).toBeCloseTo(25);
            expect(plane.origin.x).toBeCloseTo(0);
            expect(plane.origin.y).toBeCloseTo(0);
            expect(plane.normal.isEqualTo(Plane.XY.normal)).toBe(true);
            expect(plane.xvec.isEqualTo(Plane.XY.xvec)).toBe(true);
            expect(plane.yvec.isEqualTo(Plane.XY.yvec)).toBe(true);
        });

        test("offsets against the normal for a negative distance", () => {
            // ZX's normal is +Y, so a negative offset moves along −Y
            const plane = Plane.ZX.offsetAlongNormal(-30);
            expect(plane.origin.y).toBeCloseTo(-30);
        });

        test("a zero offset is the same plane, not a copy", () => {
            expect(Plane.XY.offsetAlongNormal(0)).toBe(Plane.XY);
        });

        test("returns a new plane for a non-zero offset", () => {
            expect(Plane.XY.offsetAlongNormal(5)).not.toBe(Plane.XY);
        });
    });
});
