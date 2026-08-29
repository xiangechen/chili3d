// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { distanceDimension, radiusDimension, segmentOffset } from "../../src/sketch/editor/dimensionLayout";

const PX = 0.5; // world units per pixel

describe("segmentOffset", () => {
    test("positive above the segment, negative below", () => {
        expect(segmentOffset([0, 0], [10, 0], [5, 3])).toBeCloseTo(3, 9);
        expect(segmentOffset([0, 0], [10, 0], [5, -3])).toBeCloseTo(-3, 9);
    });

    test("zero-length segment yields zero", () => {
        expect(segmentOffset([1, 1], [1, 1], [5, 5])).toBe(0);
    });
});

describe("distanceDimension", () => {
    test("extension lines, dimension line and two arrowheads at the offset side", () => {
        const geometry = distanceDimension([0, 0], [10, 0], 10, PX)!;
        expect(geometry).not.toBeNull();

        // 2 extension lines + 1 dimension line + 2 arrowheads × 2 wings
        expect(geometry.segments.length).toBe(7);

        // dimension line sits at y = offset and spans the measured segment
        const [x1, y1, x2, y2] = geometry.segments[2];
        expect([x1, y1, x2, y2]).toEqual([0, 10, 10, 10]);

        // extension lines run from near the geometry past the dimension line
        const [, ey1, , ey2] = geometry.segments[0];
        expect(ey1).toBeCloseTo(1.5, 9); // starts with a small gap above the point
        expect(ey2).toBeGreaterThan(10); // overshoots the dimension line

        // text centered on the dimension line
        expect(geometry.textPosition).toEqual([5, 10]);
    });

    test("follows moved reference points", () => {
        const moved = distanceDimension([3, 2], [13, 2], 10, PX)!;
        expect(moved.textPosition).toEqual([8, 12]);
        expect(moved.segments[2]).toEqual([3, 12, 13, 12]);
    });

    test("clamps a tiny offset to a minimum on the same side", () => {
        const geometry = distanceDimension([0, 0], [10, 0], 0.1, PX)!;
        const minOffset = 14 * PX;
        expect(geometry.segments[2][1]).toBeCloseTo(minOffset, 9);
    });

    test("negative offset renders below the segment", () => {
        const geometry = distanceDimension([0, 0], [10, 0], -10, PX)!;
        expect(geometry.segments[2][1]).toBe(-10);
    });

    test("returns undefined for a degenerate segment or zero pixel size", () => {
        expect(distanceDimension([1, 1], [1, 1], 4, PX)).toBeUndefined();
        expect(distanceDimension([0, 0], [10, 0], 4, 0)).toBeUndefined();
    });

    test("arrowheads point inward along the dimension line", () => {
        const geometry = distanceDimension([0, 0], [10, 0], 10, PX)!;
        const leftWing = geometry.segments[3]; // tip at (0,10)
        const rightWing = geometry.segments[5]; // tip at (10,10)
        // left arrow wings go right (inward), right arrow wings go left
        expect(leftWing[2]).toBeGreaterThan(leftWing[0]);
        expect(rightWing[2]).toBeLessThan(rightWing[0]);
    });
});

describe("radiusDimension", () => {
    test("leader from center through the rim with outward arrow", () => {
        const geometry = radiusDimension([0, 0], 5, 8, 0, PX);
        const [x1, y1, x2, y2] = geometry.segments[0];
        expect([x1, y1]).toEqual([0, 0]); // starts at the center
        expect([x2, y2]).toEqual([8, 0]); // label position from the anchor vector
        expect(geometry.textPosition).toEqual([8, 0]);

        // arrow tip on the circumference
        const tip = geometry.segments[1];
        expect(Math.hypot(tip[0], tip[1])).toBeCloseTo(5, 9);
        // wings point back toward the center
        expect(tip[2]).toBeLessThan(tip[0]);
    });

    test("keeps the label outside the circle when the anchor is inside", () => {
        const geometry = radiusDimension([0, 0], 10, 1, 0, PX);
        const label = geometry.textPosition;
        expect(Math.hypot(label[0], label[1])).toBeGreaterThan(10);
    });

    test("follows the circle center", () => {
        const geometry = radiusDimension([4, 3], 5, 8, 0, PX);
        expect(geometry.textPosition).toEqual([12, 3]);
        expect(geometry.segments[0].slice(0, 2)).toEqual([4, 3]);
    });
});
