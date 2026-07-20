// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox } from "../src/math/boundingBox";
import { LineSegment } from "../src/math/lineSegment";
import { Matrix4 } from "../src/math/matrix4";
import { XYZ, type XYZLike } from "../src/math/xyz";

describe("BoundingBox.isIntersect", () => {
    function box(min: XYZLike, max: XYZLike) {
        return new BoundingBox(min, max);
    }

    test("returns true for overlapping boxes", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const b = box({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 });
        expect(BoundingBox.isIntersect(a, b)).toBe(true);
        expect(BoundingBox.isIntersect(b, a)).toBe(true);
    });

    test("returns false for non-overlapping boxes", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 });
        expect(BoundingBox.isIntersect(a, b)).toBe(false);
        expect(BoundingBox.isIntersect(b, a)).toBe(false);
    });

    test("returns false for boxes touching at the edge within tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, -0.0001)).toBe(false);
    });

    test("returns false for boxes just outside tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.002, y: 1.002, z: 1.002 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b)).toBe(false);
    });

    test("returns true for boxes just within tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.0005, y: 1.0005, z: 1.0005 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, 0.001)).toBe(true);
    });

    test("works with negative coordinates", () => {
        const a = box({ x: -3, y: -3, z: -3 }, { x: -1, y: -1, z: -1 });
        const b = box({ x: -2, y: -2, z: -2 }, { x: 0, y: 0, z: 0 });
        expect(BoundingBox.isIntersect(a, b)).toBe(true);
    });

    test("returns true for identical boxes", () => {
        const a = box({ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, a)).toBe(true);
    });

    test("respects custom tolerance", () => {
        const a = box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const b = box({ x: 1.01, y: 1.01, z: 1.01 }, { x: 2, y: 2, z: 2 });
        expect(BoundingBox.isIntersect(a, b, 0.02)).toBe(true);
        expect(BoundingBox.isIntersect(a, b, 0.001)).toBe(false);
    });
});

describe("BoundingBox.transformed", () => {
    test("transforms bounding box with identity matrix", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const matrix = Matrix4.identity();
        const transformed = BoundingBox.transformed(box, matrix);
        expect(transformed.min).toEqual(box.min);
        expect(transformed.max).toEqual(box.max);
    });

    test("transforms bounding box with translation matrix", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const matrix = Matrix4.fromTranslation(2, 3, 4);
        const transformed = BoundingBox.transformed(box, matrix);
        expect(transformed.min).toEqual(new XYZ({ x: 2, y: 3, z: 4 }));
        expect(transformed.max).toEqual(new XYZ({ x: 3, y: 4, z: 5 }));
    });
});

describe("BoundingBox.center", () => {
    test("returns zero for undefined box", () => {
        expect(BoundingBox.center(undefined)).toEqual(XYZ.zero);
    });

    test("calculates center of bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 4, z: 6 }));
        const center = BoundingBox.center(box);
        expect(center).toEqual(new XYZ({ x: 1, y: 2, z: 3 }));
    });
});

describe("BoundingBox.expand", () => {
    test("expands bounding box by value", () => {
        const box = new BoundingBox(new XYZ({ x: 1, y: 1, z: 1 }), new XYZ({ x: 2, y: 2, z: 2 }));
        const expanded = BoundingBox.expand(box, 0.5);
        expect(expanded.min).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
        expect(expanded.max).toEqual({ x: 2.5, y: 2.5, z: 2.5 });
    });
});

describe("BoundingBox.wireframe", () => {
    test("generates wireframe edge mesh data", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const wireframe = BoundingBox.wireframe(box);
        expect(wireframe.position).toBeInstanceOf(Float32Array);
        expect(wireframe.position.length).toBe(72); // 24 vertices * 3 coordinates
        expect(wireframe.lineType).toBe("solid");
        expect(wireframe.range).toEqual([]);
    });
});

describe("BoundingBox.isValid", () => {
    test("returns true for valid bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        expect(BoundingBox.isValid(box)).toBe(true);
    });

    test("returns false for invalid bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 1, y: 1, z: 1 }), new XYZ({ x: 0, y: 0, z: 0 }));
        expect(BoundingBox.isValid(box)).toBe(false);
    });
});

describe("BoundingBox.isInside", () => {
    test("returns true for point inside bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 2, z: 2 }));
        const point = new XYZ({ x: 1, y: 1, z: 1 });
        expect(BoundingBox.isInside(box, point)).toBe(true);
    });

    test("returns false for point outside bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 2, z: 2 }));
        const point = new XYZ({ x: 3, y: 3, z: 3 });
        expect(BoundingBox.isInside(box, point)).toBe(false);
    });

    test("returns false for point on boundary with default tolerance", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 2, z: 2 }));
        const point = new XYZ({ x: 0, y: 0, z: 0 });
        expect(BoundingBox.isInside(box, point)).toBe(false);
    });
});

describe("BoundingBox.expandByPoint", () => {
    test("expands bounding box to include new point", () => {
        const box = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        BoundingBox.expandByPoint(box, { x: 2, y: 2, z: 2 });
        expect(box.min).toEqual({ x: 0, y: 0, z: 0 });
        expect(box.max).toEqual({ x: 2, y: 2, z: 2 });
    });

    test("does not change if point is inside", () => {
        const box = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        BoundingBox.expandByPoint(box, { x: 1, y: 1, z: 1 });
        expect(box.min).toEqual({ x: 0, y: 0, z: 0 });
        expect(box.max).toEqual({ x: 2, y: 2, z: 2 });
    });
});

describe("BoundingBox.combine", () => {
    test("returns box2 if box1 is undefined", () => {
        const box2 = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        expect(BoundingBox.combine(undefined, box2)).toEqual(box2);
    });

    test("returns box1 if box2 is undefined", () => {
        const box1 = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        expect(BoundingBox.combine(box1, undefined)).toEqual(box1);
    });

    test("combines two bounding boxes", () => {
        const box1 = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const box2 = new BoundingBox(new XYZ({ x: 1, y: 1, z: 1 }), new XYZ({ x: 2, y: 2, z: 2 }));
        const combined = BoundingBox.combine(box1, box2)!;
        expect(combined.min).toEqual({ x: 0, y: 0, z: 0 });
        expect(combined.max).toEqual({ x: 2, y: 2, z: 2 });
    });
});

describe("BoundingBox.fromNumbers", () => {
    test("creates bounding box from array of numbers", () => {
        const points = [0, 0, 0, 1, 1, 1, 2, 2, 2];
        const box = BoundingBox.fromNumbers(points);
        expect(box.min).toEqual({ x: 0, y: 0, z: 0 });
        expect(box.max).toEqual({ x: 2, y: 2, z: 2 });
    });

    test("handles empty array", () => {
        const points: number[] = [];
        const box = BoundingBox.fromNumbers(points);
        expect(box.min).toEqual({ x: Infinity, y: Infinity, z: Infinity });
        expect(box.max).toEqual({ x: -Infinity, y: -Infinity, z: -Infinity });
    });
});

describe("BoundingBox.fromPoints", () => {
    test("creates bounding box from array of points", () => {
        const points = [
            new XYZ({ x: 0, y: 0, z: 0 }),
            new XYZ({ x: 1, y: 1, z: 1 }),
            new XYZ({ x: 2, y: 2, z: 2 }),
        ];
        const box = BoundingBox.fromPoints(points);
        expect(box.min).toEqual({ x: 0, y: 0, z: 0 });
        expect(box.max).toEqual({ x: 2, y: 2, z: 2 });
    });

    test("handles empty array", () => {
        const points: XYZ[] = [];
        const box = BoundingBox.fromPoints(points);
        expect(box.min).toEqual({ x: Infinity, y: Infinity, z: Infinity });
        expect(box.max).toEqual({ x: -Infinity, y: -Infinity, z: -Infinity });
    });
});

describe("BoundingBox.isIntersectLineSegment", () => {
    test("returns true when line segment intersects the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: 0, z: 0 }),
            end: new XYZ({ x: 2, y: 0, z: 0 }),
        }); // Line going through the box horizontally
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns true when line segment is completely inside the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -2, y: -2, z: -2 }), new XYZ({ x: 2, y: 2, z: 2 }));
        const line = new LineSegment({
            start: new XYZ({ x: -1, y: 0, z: 0 }),
            end: new XYZ({ x: 1, y: 0, z: 0 }),
        }); // Line completely inside the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns false when line segment is completely outside the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -3, y: -3, z: -3 }),
            end: new XYZ({ x: -2, y: -2, z: -2 }),
        }); // Line completely outside
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    test("returns true when line segment touches one face of the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: 0, z: 0 }),
            end: new XYZ({ x: 0, y: 0, z: 0 }),
        }); // Line touching the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns true when line segment touches an edge of the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: -2, z: 0 }),
            end: new XYZ({ x: 0, y: 0, z: 0 }),
        }); // Line touching an edge
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns true when line segment touches a corner of the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: -2, z: -2 }),
            end: new XYZ({ x: 0, y: 0, z: 0 }),
        }); // Line touching a corner
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns false when line segment is parallel to one axis and outside the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -3, y: 2, z: 0 }),
            end: new XYZ({ x: 3, y: 2, z: 0 }),
        }); // Line parallel to X-axis, above the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    test("returns false when line segment is parallel to one axis and outside the bounding box (Y axis)", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: 0, y: 2, z: 0 }),
            end: new XYZ({ x: 0, y: 3, z: 0 }),
        }); // Line parallel to Y-axis, outside the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    test("returns true when line segment is diagonal and intersects the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: -2, z: -2 }),
            end: new XYZ({ x: 2, y: 2, z: 2 }),
        }); // Diagonal line through the box
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns false when line segment is parallel to one axis but within the box range", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        // Line segment parallel to X-axis but outside Y and Z bounds
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: 2, z: 2 }),
            end: new XYZ({ x: 2, y: 2, z: 2 }),
        });
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });

    test("returns true when line segment is parallel to one axis and within the box range", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        // Line segment parallel to X-axis and within Y and Z bounds
        const line = new LineSegment({
            start: new XYZ({ x: -2, y: 0, z: 0 }),
            end: new XYZ({ x: 2, y: 0, z: 0 }),
        });
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(true);
    });

    test("returns false when line segment intersects but parameter range excludes intersection", () => {
        const box = new BoundingBox(new XYZ({ x: -1, y: -1, z: -1 }), new XYZ({ x: 1, y: 1, z: 1 }));
        // Line segment that would intersect but the segment ends before reaching the box
        const line = new LineSegment({
            start: new XYZ({ x: 0, y: 0, z: -3 }),
            end: new XYZ({ x: 0, y: 0, z: -2 }),
        });
        expect(BoundingBox.isIntersectLineSegment(box, line)).toBe(false);
    });
});

describe("BoundingBox.maxSize", () => {
    test("returns the max dimension of the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 5, z: 4 }));
        expect(BoundingBox.maxSize(box)).toBe(5);
    });

    test("returns the same value for a cube", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 2, z: 2 }));
        expect(BoundingBox.maxSize(box)).toBe(2);
    });
});

describe("BoundingBox.minSize", () => {
    test("returns the min dimension of the bounding box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 5, z: 4 }));
        expect(BoundingBox.minSize(box)).toBe(3);
    });

    test("returns the same value for a cube", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 2, y: 2, z: 2 }));
        expect(BoundingBox.minSize(box)).toBe(2);
    });
});

describe("BoundingBox.diagonal", () => {
    test("returns the diagonal of a unit cube", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 1, z: 1 }));
        expect(BoundingBox.diagonal(box)).toBeCloseTo(Math.sqrt(3));
    });

    test("returns the diagonal of a rectangular box", () => {
        const box = new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 4, z: 12 }));
        // sqrt(3^2 + 4^2 + 12^2) = sqrt(9 + 16 + 144) = sqrt(169) = 13
        expect(BoundingBox.diagonal(box)).toBeCloseTo(13);
    });
});
