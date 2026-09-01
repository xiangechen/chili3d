// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    angleDimension,
    axisDistanceDimension,
    distanceDimension,
    lineIntersection,
    pointLineDistance,
    pointLineDistanceDimension,
    pointLineFoot,
    pointLineSignedDistance,
    radiusDimension,
    segmentOffset,
    toDisplayDatum,
    toStorageDatum,
} from "../../src/sketch/editor/dimensionLayout";
import { ConstraintKind } from "../../src/sketch/sketchModel";

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

describe("toDisplayDatum / toStorageDatum", () => {
    test("angles convert between radians and degrees", () => {
        expect(toDisplayDatum(ConstraintKind.Angle, Math.PI)).toBeCloseTo(180, 9);
        expect(toStorageDatum(ConstraintKind.Angle, 180)).toBeCloseTo(Math.PI, 9);
    });

    test("point-line distance flips sign between UI and storage", () => {
        expect(toDisplayDatum(ConstraintKind.P2LDistance, -30)).toBe(30);
        expect(toStorageDatum(ConstraintKind.P2LDistance, 30)).toBe(-30);
        expect(
            toDisplayDatum(ConstraintKind.P2LDistance, toStorageDatum(ConstraintKind.P2LDistance, 7)),
        ).toBe(7);
    });

    test("other kinds pass values through unchanged", () => {
        expect(toDisplayDatum(ConstraintKind.P2PDistance, 12.5)).toBe(12.5);
        expect(toStorageDatum(ConstraintKind.P2PDistance, 12.5)).toBe(12.5);
    });

    test("display and storage conversions round-trip", () => {
        const stored = toStorageDatum(
            ConstraintKind.Angle,
            toDisplayDatum(ConstraintKind.Angle, Math.PI / 3),
        );
        expect(stored).toBeCloseTo(Math.PI / 3, 9);
        expect(
            toDisplayDatum(ConstraintKind.P2PDistance, toStorageDatum(ConstraintKind.P2PDistance, 7)),
        ).toBe(7);
    });
});

describe("pointLineFoot", () => {
    test("foot of the perpendicular onto a horizontal line", () => {
        expect(pointLineFoot([3, 4], [0, 0], [10, 0])).toEqual([3, 0]);
    });

    test("degenerate line returns undefined", () => {
        expect(pointLineFoot([3, 4], [1, 1], [1, 1])).toBeUndefined();
    });
});

describe("pointLineDistance", () => {
    test("perpendicular distance to the line", () => {
        expect(pointLineDistance([3, 4], [0, 0], [10, 0])).toBeCloseTo(4, 9);
    });

    test("degenerate line yields zero", () => {
        expect(pointLineDistance([3, 4], [1, 1], [1, 1])).toBe(0);
    });
});

describe("pointLineSignedDistance", () => {
    test("positive left of the line direction, negative right", () => {
        expect(pointLineSignedDistance([3, 4], [0, 0], [10, 0])).toBeCloseTo(4, 9);
        expect(pointLineSignedDistance([3, -4], [0, 0], [10, 0])).toBeCloseTo(-4, 9);
        // reversed line direction flips the sign
        expect(pointLineSignedDistance([3, 4], [10, 0], [0, 0])).toBeCloseTo(-4, 9);
    });

    test("degenerate line yields zero", () => {
        expect(pointLineSignedDistance([3, 4], [1, 1], [1, 1])).toBe(0);
    });
});

describe("lineIntersection", () => {
    test("crossing lines return the intersection point", () => {
        expect(lineIntersection([0, 0], [10, 10], [0, 10], [10, 0])).toEqual([5, 5]);
    });

    test("parallel lines return undefined", () => {
        expect(lineIntersection([0, 0], [10, 0], [0, 5], [10, 5])).toBeUndefined();
    });
});

describe("axisDistanceDimension", () => {
    test("horizontal dimension line at the offset above the midline", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", 20, 1)!;
        expect(geometry).not.toBeNull();

        // 2 extension lines + 1 dimension line + 2 arrowheads × 2 wings
        expect(geometry.segments.length).toBe(7);

        // midline y = 2, dimension line horizontal at y = 22 spanning both points
        expect(geometry.segments[2]).toEqual([0, 22, 10, 22]);
        expect(geometry.textPosition).toEqual([5, 22]);
    });

    test("clamps a tiny offset to a minimum on the same side", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", 5, 1)!;
        expect(geometry.segments[2][1]).toBeCloseTo(16, 9); // midline 2 + MIN_OFFSET_PX 14
    });

    test("negative offset mirrors below the midline", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", -20, 1)!;
        expect(geometry.segments[2]).toEqual([0, -18, 10, -18]);
        expect(geometry.textPosition).toEqual([5, -18]);
    });

    test("vertical dimension line at the offset from the midline", () => {
        const geometry = axisDistanceDimension([0, 0], [4, 10], "v", 20, 1)!;
        // midline x = 2, dimension line vertical at x = 22
        expect(geometry.segments[2]).toEqual([22, 0, 22, 10]);
        expect(geometry.textPosition).toEqual([22, 5]);
    });

    test("returns undefined when the span along the axis is zero", () => {
        expect(axisDistanceDimension([5, 0], [5, 10], "h", 20, 1)).toBeUndefined();
    });
});

describe("pointLineDistanceDimension", () => {
    test("dimension line parallel to the point→foot direction, shifted by the offset", () => {
        const geometry = pointLineDistanceDimension([0, 10], [0, 0], [10, 0], 20, 1)!;
        expect(geometry).not.toBeNull();

        // foot = (0,0), direction p→foot = (0,-1), normal = (1,0)
        expect(geometry.segments.length).toBe(7);
        expect(geometry.segments[2]).toEqual([20, 10, 20, 0]);
        expect(geometry.textPosition).toEqual([20, 5]);
    });

    test("returns undefined when the point is on the line", () => {
        expect(pointLineDistanceDimension([5, 0], [0, 0], [10, 0], 20, 1)).toBeUndefined();
    });

    test("returns undefined for a degenerate line", () => {
        expect(pointLineDistanceDimension([0, 10], [1, 1], [1, 1], 20, 1)).toBeUndefined();
    });
});

describe("angleDimension", () => {
    test("arc clamped to the minimum radius, label on the sweep bisector", () => {
        const geometry = angleDimension([0, 0], [1, 0], [0, 1], 10, 1)!;
        expect(geometry).not.toBeNull();

        // 90° sweep → 8 arc segments + 2 arrowheads × 2 wings
        expect(geometry.segments.length).toBe(12);

        // label at 45° at distance 24 + 14
        expect(geometry.textPosition[0]).toBeCloseTo(38 * Math.SQRT1_2, 9);
        expect(geometry.textPosition[1]).toBeCloseTo(38 * Math.SQRT1_2, 9);
    });

    test("arc segment endpoints lie on the clamped circle", () => {
        const geometry = angleDimension([0, 0], [1, 0], [0, 1], 10, 1)!;
        for (const index of [0, 3, 7]) {
            const [x1, y1, x2, y2] = geometry.segments[index];
            expect(Math.hypot(x1, y1)).toBeCloseTo(24, 9);
            expect(Math.hypot(x2, y2)).toBeCloseTo(24, 9);
        }
    });

    test("sweeps the short way for a clockwise angle", () => {
        const geometry = angleDimension([0, 0], [1, 0], [0, -1], 10, 1)!;
        expect(geometry.textPosition[0]).toBeCloseTo(38 * Math.SQRT1_2, 9);
        expect(geometry.textPosition[1]).toBeCloseTo(-38 * Math.SQRT1_2, 9);
    });

    test("returns undefined for a zero-length direction or zero sweep", () => {
        expect(angleDimension([0, 0], [0, 0], [0, 1], 10, 1)).toBeUndefined();
        expect(angleDimension([0, 0], [1, 0], [2, 0], 10, 1)).toBeUndefined();
    });
});
