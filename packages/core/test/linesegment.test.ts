// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { LineSegment, XYZ } from "../src";

describe("test linesegment", () => {
    test("test constructor", () => {
        const start = new XYZ({ x: 0, y: 0, z: 0 });
        const end = new XYZ({ x: 1, y: 0, z: 0 });
        const segment = new LineSegment({ start, end });
        expect(segment.start).toStrictEqual(start);
        expect(segment.end).toStrictEqual(end);

        expect(() => new LineSegment({ start, end: start })).toThrow("start and end can not be equal");
    });

    test("test distanceTo with parallel segments", () => {
        const seg1 = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 1, y: 0, z: 0 }),
        });
        const seg2 = new LineSegment({
            start: new XYZ({ x: 0, y: 1, z: 0 }),
            end: new XYZ({ x: 1, y: 1, z: 0 }),
        });
        const result1 = seg1.distanceTo(seg2);
        expect(result1.distance).toBeCloseTo(1);
        expect(result1.pointOnThis).toStrictEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(result1.pointOnRight).toStrictEqual(new XYZ({ x: 0, y: 1, z: 0 }));

        const seg3 = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 3, y: 0, z: 0 }),
        });
        const seg4 = new LineSegment({
            start: new XYZ({ x: 1, y: 1, z: 0 }),
            end: new XYZ({ x: 2, y: 1, z: 0 }),
        });
        const result2 = seg3.distanceTo(seg4);
        expect(result2.distance).toBeCloseTo(1);

        const result3 = seg1.distanceTo(seg4);
        expect(result3.distance).toBeCloseTo(1);

        const seg5 = new LineSegment({
            start: new XYZ({ x: 2, y: 1, z: 0 }),
            end: new XYZ({ x: 3, y: 1, z: 0 }),
        });
        const result4 = seg5.distanceTo(seg1);
        expect(result4.distance).toBeCloseTo(Math.sqrt(2));
    });

    test("test distanceTo with intersecting segments", () => {
        const seg1 = new LineSegment({
            start: new XYZ({ x: -1, y: 0, z: 0 }),
            end: new XYZ({ x: 1, y: 0, z: 0 }),
        });
        const seg2 = new LineSegment({
            start: new XYZ({ x: 0, y: -1, z: 0 }),
            end: new XYZ({ x: 0, y: 1, z: 0 }),
        });
        const result = seg1.distanceTo(seg2);
        expect(result.distance).toBeCloseTo(0);
        expect(result.pointOnThis).toStrictEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(result.pointOnRight).toStrictEqual(new XYZ({ x: 0, y: 0, z: 0 }));
    });

    test("test distanceTo with skew segments", () => {
        const seg1 = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 1, y: 0, z: 0 }),
        });
        const seg2 = new LineSegment({
            start: new XYZ({ x: 0, y: 1, z: 1 }),
            end: new XYZ({ x: 1, y: 1, z: 1 }),
        });
        const seg3 = new LineSegment({
            start: new XYZ({ x: 0.5, y: 0.5, z: 0 }),
            end: new XYZ({ x: 1, y: 1, z: 0 }),
        });

        const result1 = seg1.distanceTo(seg2);
        expect(result1.distance).toBeCloseTo(Math.sqrt(2));

        const result2 = seg1.distanceTo(seg3);
        expect(result2.distance).toBeCloseTo(0.5);
    });

    test("test distanceTo with collinear segments", () => {
        const seg1 = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 1, y: 0, z: 0 }),
        });
        const seg2 = new LineSegment({
            start: new XYZ({ x: 2, y: 0, z: 0 }),
            end: new XYZ({ x: 3, y: 0, z: 0 }),
        });
        const result1 = seg1.distanceTo(seg2);
        expect(result1.distance).toBeCloseTo(1);
        expect(result1.pointOnThis).toStrictEqual(new XYZ({ x: 1, y: 0, z: 0 }));
        expect(result1.pointOnRight).toStrictEqual(new XYZ({ x: 2, y: 0, z: 0 }));

        const seg3 = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 2, y: 0, z: 0 }),
        });
        const seg4 = new LineSegment({
            start: new XYZ({ x: 1, y: 0, z: 0 }),
            end: new XYZ({ x: 3, y: 0, z: 0 }),
        });
        const result2 = seg3.distanceTo(seg4);
        expect(result2.pointOnThis).toStrictEqual(new XYZ({ x: 1, y: 0, z: 0 }));
        expect(result2.pointOnRight).toStrictEqual(new XYZ({ x: 1, y: 0, z: 0 }));
        expect(result2.distance).toBeCloseTo(0);
    });

    test("test distanceToPoint", () => {
        const segment = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 2, y: 0, z: 0 }),
        });
        const point1 = new XYZ({ x: 1, y: 1, z: 0 });
        expect(segment.distanceToPoint(point1)).toBeCloseTo(1);

        const point2 = new XYZ({ x: -1, y: 1, z: 0 });
        expect(segment.distanceToPoint(point2)).toBeCloseTo(Math.sqrt(2));

        const point3 = new XYZ({ x: 3, y: 1, z: 0 });
        expect(segment.distanceToPoint(point3)).toBeCloseTo(Math.sqrt(2));

        const point4 = new XYZ({ x: 1, y: 0, z: 0 });
        expect(segment.distanceToPoint(point4)).toBeCloseTo(0);

        const segment3D = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: 0 }),
            end: new XYZ({ x: 0, y: 0, z: 2 }),
        });
        const point3D = new XYZ({ x: 1, y: 0, z: 1 });
        expect(segment3D.distanceToPoint(point3D)).toBeCloseTo(1);
    });
});
