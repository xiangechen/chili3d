// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox } from "../src/math/boundingBox";
import { LineSegment } from "../src/math/lineSegment";
import { XYZ, type XYZLike } from "../src/math/xyz";

describe("BoundingBox.isIntersect", () => {
    function box(min: XYZLike, max: XYZLike) {
        return new BoundingBox(min, max);
    }

    it("returns true for overlapping boxes", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const b = box({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 });
        expect(BoundingBox.isIntersect(a, b)).toBe(true);
        expect(BoundingBox.isIntersect(b, a)).toBe(true);
    });

    it("returns false for non-overlapping boxes", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 });
        expect(BoundingBox.isIntersect(a, b)).toBe(false);
        expect(BoundingBox.isIntersect(b, a)).toBe(false);
    });

    it("returns false for boxes touching at the edge within tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, -0.0001)).toBe(false);
    });

    it("returns false for boxes just outside tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.002, y: 1.002, z: 1.002 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b)).toBe(false);
    });

    it("returns true for boxes just within tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.0005, y: 1.0005, z: 1.0005 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, 0.001)).toBe(true);
    });

    it("works with negative coordinates", () => {
        const a = box({ x: -3, y: -3, z: -3 }, { x: -1, y: -1, z: -1 });
        const b = box({ x: -2, y: -2, z: -2 }, { x: 0, y: 0, z: 0 });
        expect(BoundingBox.isIntersect(a, b)).toBe(true);
    });

    it("returns true for identical boxes", () => {
        const a = box({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, a)).toBe(true);
    });

    it("respects custom tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.01, y: 1.01, z: 1.01 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, 0.02)).toBe(true);
        expect(BoundingBox.isIntersect(a, b, 0.001)).toBe(false);
    });
});

describe("BoundingBox.isIntersectLineSegment", () => {
    it("returns true when line segment intersects the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-2, 0, 0), new XYZ(2, 0, 0)); // Line going through the box horizontally
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    it("returns true when line segment is completely inside the bounding box", () => {
        const box = new BoundingBox(new XYZ(-2, -2, -2), new XYZ(2, 2, 2));
        const line = new LineSegment(new XYZ(-1, 0, 0), new XYZ(1, 0, 0)); // Line completely inside the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    it("returns false when line segment is completely outside the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-3, -3, -3), new XYZ(-2, -2, -2)); // Line completely outside
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    it("returns true when line segment touches one face of the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-2, 0, 0), new XYZ(0, 0, 0)); // Line touching the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    it("returns true when line segment touches an edge of the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-2, -2, 0), new XYZ(0, 0, 0)); // Line touching an edge
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    it("returns true when line segment touches a corner of the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-2, -2, -2), new XYZ(0, 0, 0)); // Line touching a corner
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    it("returns false when line segment is parallel to one axis and outside the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-3, 2, 0), new XYZ(3, 2, 0)); // Line parallel to X-axis, above the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    it("returns false when line segment is parallel to one axis and outside the bounding box (Y axis)", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(0, 2, 0), new XYZ(0, 3, 0)); // Line parallel to Y-axis, outside the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    it("returns true when line segment is diagonal and intersects the bounding box", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        const line = new LineSegment(new XYZ(-2, -2, -2), new XYZ(2, 2, 2)); // Diagonal line through the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    it("returns false when line segment is parallel to one axis but within the box range", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        // Line segment parallel to X-axis but outside Y and Z bounds
        const line = new LineSegment(new XYZ(-2, 2, 2), new XYZ(2, 2, 2));
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    it("returns true when line segment is parallel to one axis and within the box range", () => {
        const box = new BoundingBox(new XYZ(-1, -1, -1), new XYZ(1, 1, 1));
        // Line segment parallel to X-axis and within Y and Z bounds
        const line = new LineSegment(new XYZ(-2, 0, 0), new XYZ(2, 0, 0));
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });
});
