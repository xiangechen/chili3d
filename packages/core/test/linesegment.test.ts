// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { LineSegment, XYZ } from "../src";

describe("test linesegment", () => {
    test("test constructor", () => {
        const start = new XYZ(0, 0, 0);
        const end = new XYZ(1, 0, 0);
        const segment = new LineSegment(start, end);
        expect(segment.start).toStrictEqual(start);
        expect(segment.end).toStrictEqual(end);

        expect(() => new LineSegment(start, start)).toThrow("start and end can not be equal");
    });

    test("test distanceTo with parallel segments", () => {
        const seg1 = new LineSegment(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
        const seg2 = new LineSegment(new XYZ(0, 1, 0), new XYZ(1, 1, 0));
        const result1 = seg1.distanceTo(seg2);
        expect(result1.distance).toBeCloseTo(1);
        expect(result1.pointOnThis).toStrictEqual(new XYZ(0, 0, 0));
        expect(result1.pointOnRight).toStrictEqual(new XYZ(0, 1, 0));

        const seg3 = new LineSegment(new XYZ(0, 0, 0), new XYZ(3, 0, 0));
        const seg4 = new LineSegment(new XYZ(1, 1, 0), new XYZ(2, 1, 0));
        const result2 = seg3.distanceTo(seg4);
        expect(result2.distance).toBeCloseTo(1);

        const result3 = seg1.distanceTo(seg4);
        expect(result3.distance).toBeCloseTo(1);

        const seg5 = new LineSegment(new XYZ(2, 1, 0), new XYZ(3, 1, 0));
        const result4 = seg5.distanceTo(seg1);
        expect(result4.distance).toBeCloseTo(Math.sqrt(2));
    });

    test("test distanceTo with intersecting segments", () => {
        const seg1 = new LineSegment(new XYZ(-1, 0, 0), new XYZ(1, 0, 0));
        const seg2 = new LineSegment(new XYZ(0, -1, 0), new XYZ(0, 1, 0));
        const result = seg1.distanceTo(seg2);
        expect(result.distance).toBeCloseTo(0);
        expect(result.pointOnThis).toStrictEqual(new XYZ(0, 0, 0));
        expect(result.pointOnRight).toStrictEqual(new XYZ(0, 0, 0));
    });

    test("test distanceTo with skew segments", () => {
        const seg1 = new LineSegment(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
        const seg2 = new LineSegment(new XYZ(0, 1, 1), new XYZ(1, 1, 1));
        const seg3 = new LineSegment(new XYZ(0.5, 0.5, 0), new XYZ(1, 1, 0));

        const result1 = seg1.distanceTo(seg2);
        expect(result1.distance).toBeCloseTo(Math.sqrt(2));

        const result2 = seg1.distanceTo(seg3);
        expect(result2.distance).toBeCloseTo(0.5);
    });

    test("test distanceTo with collinear segments", () => {
        const seg1 = new LineSegment(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
        const seg2 = new LineSegment(new XYZ(2, 0, 0), new XYZ(3, 0, 0));
        const result1 = seg1.distanceTo(seg2);
        expect(result1.distance).toBeCloseTo(1);
        expect(result1.pointOnThis).toStrictEqual(new XYZ(1, 0, 0));
        expect(result1.pointOnRight).toStrictEqual(new XYZ(2, 0, 0));

        const seg3 = new LineSegment(new XYZ(0, 0, 0), new XYZ(2, 0, 0));
        const seg4 = new LineSegment(new XYZ(1, 0, 0), new XYZ(3, 0, 0));
        const result2 = seg3.distanceTo(seg4);
        expect(result2.pointOnThis).toStrictEqual(new XYZ(1, 0, 0));
        expect(result2.pointOnRight).toStrictEqual(new XYZ(1, 0, 0));
        expect(result2.distance).toBeCloseTo(0);
    });

    test("test distanceToPoint", () => {
        // Test point closest to the middle of the segment
        const segment = new LineSegment(new XYZ(0, 0, 0), new XYZ(2, 0, 0));
        const point1 = new XYZ(1, 1, 0);
        expect(segment.distanceToPoint(point1)).toBeCloseTo(1);

        // Test point closest to start of segment
        const point2 = new XYZ(-1, 1, 0);
        expect(segment.distanceToPoint(point2)).toBeCloseTo(Math.sqrt(2));

        // Test point closest to end of segment
        const point3 = new XYZ(3, 1, 0);
        expect(segment.distanceToPoint(point3)).toBeCloseTo(Math.sqrt(2));

        // Test point on the segment
        const point4 = new XYZ(1, 0, 0);
        expect(segment.distanceToPoint(point4)).toBeCloseTo(0);

        // Test with 3D points
        const segment3D = new LineSegment(new XYZ(0, 0, 0), new XYZ(0, 0, 2));
        const point3D = new XYZ(1, 0, 1);
        expect(segment3D.distanceToPoint(point3D)).toBeCloseTo(1);
    });
});
