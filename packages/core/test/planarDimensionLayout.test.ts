// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    angleDimension,
    angleVertex,
    axisDistanceDimension,
    type DimensionSize,
    diameterDimension,
    distanceDimension,
    labelOnAxis,
    labelOnSegment,
    lineIntersection,
    measuresSupplement,
    type Point2,
    pointLineDistance,
    pointLineDistanceDimension,
    pointLineFoot,
    pointLineSignedDistance,
    radiusDimension,
    segmentAlong,
    segmentOffset,
    signedSweep,
} from "../src/model/planarDimensionLayout";

/** One world unit per screen pixel, text a drafting 23 units tall. */
const SIZE: DimensionSize = { scale: 1, textHeight: 23 };
/** Half a world unit per pixel — the scale the furniture's pixel sizing is checked at. */
const PX_SIZE: DimensionSize = { scale: 0.5, textHeight: 11.5 };
/** Text anchor lift off the line: half the text height the size carries. */
const raise = (size: DimensionSize) => size.textHeight / 2;
/** A unit vector at `degrees`. */
const at = (degrees: number): [number, number] => {
    const radians = (degrees * Math.PI) / 180;
    return [Math.cos(radians), Math.sin(radians)];
};

describe("segmentOffset", () => {
    test("positive above the segment, negative below", () => {
        expect(segmentOffset([0, 0], [10, 0], [5, 3])).toBeCloseTo(3, 9);
        expect(segmentOffset([0, 0], [10, 0], [5, -3])).toBeCloseTo(-3, 9);
    });

    test("zero-length segment yields zero", () => {
        expect(segmentOffset([1, 1], [1, 1], [5, 5])).toBe(0);
    });
});

describe("segmentAlong", () => {
    test("distance from the first point along the segment, clamped into it", () => {
        expect(segmentAlong([0, 0], [10, 0], [4, 3])).toBeCloseTo(4, 9);
        expect(segmentAlong([0, 0], [10, 0], [-4, 3])).toBe(0);
        expect(segmentAlong([0, 0], [10, 0], [40, 3])).toBe(10);
    });

    test("zero-length segment yields zero", () => {
        expect(segmentAlong([1, 1], [1, 1], [5, 5])).toBe(0);
    });
});

describe("labelOnSegment", () => {
    test("the label frame of a pick: signed across, along from the first point", () => {
        expect(labelOnSegment([0, 0], [10, 0], [4, 3])).toEqual({ offset: 3, along: 4 });
        // a pick behind the start keeps its side but clamps back onto the segment
        expect(labelOnSegment([0, 0], [10, 0], [-4, -3])).toEqual({ offset: -3, along: 0 });
    });
});

describe("labelOnAxis", () => {
    test("offset across from the points' midline, along the axis from the first point", () => {
        expect(labelOnAxis([0, 0], [10, 4], "h", [3, 25])).toEqual({ offset: 23, along: 3 });
        expect(labelOnAxis([0, 0], [4, 10], "v", [25, 3])).toEqual({ offset: 23, along: 3 });
    });

    test("clamps along between the two points, negative when the span runs backwards", () => {
        expect(labelOnAxis([0, 0], [10, 4], "h", [40, 0])).toEqual({ offset: -2, along: 10 });
        // x runs 10 → 0, so a pick at x = 3 sits 7 behind the first point
        expect(labelOnAxis([10, 0], [0, 4], "h", [3, 0])).toEqual({ offset: -2, along: -7 });
    });
});

describe("distanceDimension", () => {
    test("extension lines, dimension line and two arrowheads at the offset side", () => {
        const geometry = distanceDimension([0, 0], [10, 0], { offset: 10 }, PX_SIZE)!;
        expect(geometry).not.toBeNull();

        // 2 extension lines + 1 dimension line; the arrowheads are solid triangles
        expect(geometry.segments.length).toBe(3);
        expect(geometry.triangles.length).toBe(2 * 3);

        // dimension line sits at y = offset and spans the measured segment
        const [x1, y1, x2, y2] = geometry.segments[2];
        expect([x1, y1, x2, y2]).toEqual([0, 10, 10, 10]);

        // extension lines run from near the geometry past the dimension line
        const [, ey1, , ey2] = geometry.segments[0];
        expect(ey1).toBeCloseTo(1.5, 9); // starts with a small gap above the point
        expect(ey2).toBeGreaterThan(10); // overshoots the dimension line

        // text centered on the dimension line, raised half a text height above it
        expect(geometry.textPosition).toEqual([5, 10 + raise(PX_SIZE)]);
        expect(geometry.textDirection).toEqual([1, 0]);
    });

    test("follows moved reference points", () => {
        const moved = distanceDimension([3, 2], [13, 2], { offset: 10 }, PX_SIZE)!;
        expect(moved.textPosition).toEqual([8, 12 + raise(PX_SIZE)]);
        expect(moved.segments[2]).toEqual([3, 12, 13, 12]);
    });

    test("the label goes where its along puts it, clamped into the segment", () => {
        // a fifth of the way along, standing on the dimension line
        const near = distanceDimension([0, 0], [10, 0], { offset: 10, along: 2 }, PX_SIZE)!;
        expect(near.textPosition).toEqual([2, 10 + raise(PX_SIZE)]);

        // past either end clamps onto the arrowheads rather than off the line
        expect(distanceDimension([0, 0], [10, 0], { offset: 10, along: 25 }, PX_SIZE)?.textPosition).toEqual([
            10,
            10 + raise(PX_SIZE),
        ]);
        expect(distanceDimension([0, 0], [10, 0], { offset: 10, along: -25 }, PX_SIZE)?.textPosition).toEqual(
            [0, 10 + raise(PX_SIZE)],
        );
    });

    test("an along stored against a longer segment clamps when the geometry shrinks", () => {
        const geometry = distanceDimension([0, 0], [4, 0], { offset: 10, along: 30 }, PX_SIZE)!;
        expect(geometry.textPosition).toEqual([4, 10 + raise(PX_SIZE)]);
    });

    test("clamps a tiny offset to a minimum on the same side", () => {
        const geometry = distanceDimension([0, 0], [10, 0], { offset: 0.1 }, PX_SIZE)!;
        const minOffset = 14 * PX_SIZE.scale;
        expect(geometry.segments[2][1]).toBeCloseTo(minOffset, 9);
    });

    test("negative offset renders below the segment", () => {
        const geometry = distanceDimension([0, 0], [10, 0], { offset: -10 }, PX_SIZE)!;
        expect(geometry.segments[2][1]).toBe(-10);
        // the text flips to the outer side of the dimension line
        expect(geometry.textPosition).toEqual([5, -10 - raise(PX_SIZE)]);
    });

    test("negative offset keeps the extension lines on the same side — no crossing", () => {
        const geometry = distanceDimension([0, 0], [10, 0], { offset: -10 }, PX_SIZE)!;
        for (const index of [0, 1]) {
            const [, ey1, , ey2] = geometry.segments[index];
            expect(ey1).toBeCloseTo(-1.5, 9); // gap starts below the point
            expect(ey2).toBeLessThan(-10); // overshoots the dimension line below
        }
    });

    test("returns undefined for a degenerate segment or zero pixel size", () => {
        expect(distanceDimension([1, 1], [1, 1], { offset: 4 }, PX_SIZE)).toBeUndefined();
        expect(
            distanceDimension([0, 0], [10, 0], { offset: 4 }, { scale: 0, textHeight: 0 }),
        ).toBeUndefined();
    });

    test("arrowheads are solid triangles with tips on the extension lines", () => {
        const geometry = distanceDimension([0, 0], [10, 0], { offset: 10 }, PX_SIZE)!;
        const triangles = geometry.triangles;
        // left tip at (0,10), right tip at (10,10)
        expect(triangles[0]).toEqual([0, 10]);
        expect(triangles[3]).toEqual([10, 10]);
        // the base corners sit inward of the tips along the dimension line
        expect(triangles[1][0]).toBeGreaterThan(0);
        expect(triangles[2][0]).toBeGreaterThan(0);
        expect(triangles[4][0]).toBeLessThan(10);
        expect(triangles[5][0]).toBeLessThan(10);
        // and fan out across it: one corner above, one below
        expect(triangles[1][1]).toBeGreaterThan(10);
        expect(triangles[2][1]).toBeLessThan(10);
    });
});

describe("radiusDimension", () => {
    test("leader from center through the rim, arrow pointing back at the center", () => {
        // 30 is past the rim (5) and the 20px margin at 0.5 (10): the pick stands
        const geometry = radiusDimension([0, 0], 5, [30, 0], PX_SIZE);
        const [x1, y1, x2, y2] = geometry.segments[0];
        expect([x1, y1]).toEqual([0, 0]); // starts at the center
        expect([x2, y2]).toEqual([30, 0]); // label position from the anchor vector
        // raised half a text height off the leader, direction along it
        expect(geometry.textPosition).toEqual([30, raise(PX_SIZE)]);
        expect(geometry.textDirection).toEqual([1, 0]);

        // solid arrowhead: tip on the circumference, base corners trailing out along
        // the leader — so the head points back at the center it measures from
        expect(geometry.segments.length).toBe(1);
        const [tip, corner1, corner2] = geometry.triangles;
        expect(Math.hypot(tip[0], tip[1])).toBeCloseTo(5, 9);
        expect(corner1[0]).toBeGreaterThan(tip[0]);
        expect(corner2[0]).toBeGreaterThan(tip[0]);
        // the corners fan out across the leader: one above, one below
        const cornerYs = [corner1[1], corner2[1]].sort((a, b) => a - b);
        expect(cornerYs[0]).toBeLessThan(0);
        expect(cornerYs[1]).toBeGreaterThan(0);
    });

    test("pushes a label inside the rim margin out past the rim", () => {
        // radius 10 + margin 10 at 0.5: a pick at 1 lands at 20, clear of the circle
        const geometry = radiusDimension([0, 0], 10, [1, 0], PX_SIZE);
        expect(geometry.textPosition).toEqual([20, raise(PX_SIZE)]);
    });

    test("follows the circle center", () => {
        const geometry = radiusDimension([4, 3], 5, [30, 0], PX_SIZE);
        expect(geometry.textPosition).toEqual([34, 3 + raise(PX_SIZE)]);
        expect(geometry.segments[0].slice(0, 2)).toEqual([4, 3]);
    });
});

describe("diameterDimension", () => {
    test("dimension line across the circle, an arrowhead on each rim pointing out", () => {
        // 30 is past the rim (5) and the 20px margin at 0.5 (10), so a leader reaches it
        const geometry = diameterDimension([0, 0], 5, [30, 0], PX_SIZE);

        // one line from the far rim, through the center, out past the near rim to the label
        expect(geometry.segments).toEqual([[-5, 0, 30, 0]]);
        expect(geometry.textPosition).toEqual([30, raise(PX_SIZE)]);
        expect(geometry.textDirection).toEqual([1, 0]);

        // two solid heads, both with their tips on the rim and their bases turned inward —
        // so each points out of the circle, which is what reads as a diameter and not a radius
        expect(geometry.triangles.length).toBe(6);
        const [nearTip, nearCorner1, nearCorner2, farTip, farCorner1, farCorner2] = geometry.triangles;
        expect(nearTip).toEqual([-5, 0]);
        expect(farTip).toEqual([5, 0]);
        expect(nearCorner1[0]).toBeGreaterThan(nearTip[0]);
        expect(nearCorner2[0]).toBeGreaterThan(nearTip[0]);
        expect(farCorner1[0]).toBeLessThan(farTip[0]);
        expect(farCorner2[0]).toBeLessThan(farTip[0]);
        // each pair fans out across the line: one corner above it, one below
        for (const [up, down] of [
            [nearCorner1[1], nearCorner2[1]],
            [farCorner1[1], farCorner2[1]],
        ]) {
            expect(Math.min(up, down)).toBeLessThan(0);
            expect(Math.max(up, down)).toBeGreaterThan(0);
        }
    });

    test("pushes a label inside the rim margin out past the rim", () => {
        // radius 10 + margin 10 at 0.5: a pick at 1 lands at 20, clear of the circle
        const geometry = diameterDimension([0, 0], 10, [1, 0], PX_SIZE);
        expect(geometry.segments).toEqual([[-10, 0, 20, 0]]);
        expect(geometry.textPosition).toEqual([20, raise(PX_SIZE)]);
    });

    test("follows the circle center", () => {
        const geometry = diameterDimension([4, 3], 5, [30, 0], PX_SIZE);
        expect(geometry.textPosition).toEqual([34, 3 + raise(PX_SIZE)]);
        expect(geometry.segments[0]).toEqual([-1, 3, 34, 3]);
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

describe("angleVertex", () => {
    test("crossing lines take the corner", () => {
        expect(angleVertex([-10, 0], [10, 0], [0, -10], [0, 10])).toEqual([0, 0]);
    });

    test("parallel lines fall back to the centroid of the four points", () => {
        expect(angleVertex([0, 0], [10, 0], [0, 5], [10, 5])).toEqual([5, 2.5]);
    });
});

describe("axisDistanceDimension", () => {
    test("horizontal dimension line at the offset above the midline", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", { offset: 20 }, SIZE)!;
        expect(geometry).not.toBeNull();

        // 2 extension lines + 1 dimension line; the arrowheads are solid triangles
        expect(geometry.segments.length).toBe(3);
        expect(geometry.triangles.length).toBe(2 * 3);

        // midline y = 2, dimension line horizontal at y = 22 spanning both points
        expect(geometry.segments[2]).toEqual([0, 22, 10, 22]);
        // raised half a text height (at px = 1) above the line
        expect(geometry.textPosition).toEqual([5, 22 + raise(SIZE)]);
        expect(geometry.textDirection).toEqual([1, 0]);
    });

    test("clamps a tiny offset to a minimum on the same side", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", { offset: 5 }, SIZE)!;
        expect(geometry.segments[2][1]).toBeCloseTo(16, 9); // midline 2 + MIN_OFFSET_PX 14
    });

    test("negative offset mirrors below the midline", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", { offset: -20 }, SIZE)!;
        expect(geometry.segments[2]).toEqual([0, -18, 10, -18]);
        expect(geometry.textPosition).toEqual([5, -18 - raise(SIZE)]);
    });

    test("vertical dimension line at the offset from the midline", () => {
        const geometry = axisDistanceDimension([0, 0], [4, 10], "v", { offset: 20 }, SIZE)!;
        // midline x = 2, dimension line vertical at x = 22
        expect(geometry.segments[2]).toEqual([22, 0, 22, 10]);
        expect(geometry.textPosition).toEqual([22 + raise(SIZE), 5]);
        expect(geometry.textDirection).toEqual([0, 1]);
    });

    test("the label slides along the axis, clamped between the two points", () => {
        const geometry = axisDistanceDimension([0, 0], [10, 4], "h", { offset: 20, along: 3 }, SIZE)!;
        expect(geometry.textPosition).toEqual([3, 22 + raise(SIZE)]);
        expect(geometry.segments[2]).toEqual([0, 22, 10, 22]); // the line itself does not move

        const past = axisDistanceDimension([0, 0], [10, 4], "h", { offset: 20, along: 40 }, SIZE)!;
        expect(past.textPosition).toEqual([10, 22 + raise(SIZE)]);
    });

    test("a backwards span keeps the label at its axis coordinate", () => {
        // x runs 10 → 0; along -7 from the first point lands on x = 3
        const geometry = axisDistanceDimension([10, 0], [0, 4], "h", { offset: 20, along: -7 }, SIZE)!;
        expect(geometry.segments[2]).toEqual([10, 22, 0, 22]);
        expect(geometry.textPosition).toEqual([3, 22 + raise(SIZE)]);
    });

    test("the arrow bodies fall inside the span, whichever way the two points run", () => {
        // the pick order decides which point is `p1`, and neither way round may hang an arrowhead
        // outside the dimension line. An arrowhead is [tip, corner, corner] with the corners an
        // arrow's length behind the tip, so the corners' midpoint is inside the span only when
        // the arrow was aimed along it.
        const bodyMiddles = (axis: "h" | "v", p1: Point2, p2: Point2): number[] => {
            const geometry = axisDistanceDimension(p1, p2, axis, { offset: 20 }, SIZE)!;
            const [, c1, c2, , c3, c4] = geometry.triangles;
            const index = axis === "h" ? 0 : 1;
            return [(c1[index] + c2[index]) / 2, (c3[index] + c4[index]) / 2];
        };

        const cases: ["h" | "v", Point2, Point2][] = [
            ["h", [0, 0], [10, 4]],
            ["h", [10, 0], [0, 4]],
            ["v", [0, 0], [4, 10]],
            ["v", [0, 10], [4, 0]],
        ];
        for (const [axis, p1, p2] of cases) {
            for (const coordinate of bodyMiddles(axis, p1, p2)) {
                expect(coordinate).toBeGreaterThan(0);
                expect(coordinate).toBeLessThan(10);
            }
        }
    });

    test("returns undefined when the span along the axis is zero", () => {
        expect(axisDistanceDimension([5, 0], [5, 10], "h", { offset: 20 }, SIZE)).toBeUndefined();
    });
});

describe("pointLineDistanceDimension", () => {
    test("dimension line parallel to the point→foot direction, shifted by the offset", () => {
        const geometry = pointLineDistanceDimension([0, 10], [0, 0], [10, 0], { offset: 20 }, SIZE)!;
        expect(geometry).not.toBeNull();

        // foot = (0,0), direction p→foot = (0,-1), normal = (1,0)
        expect(geometry.segments.length).toBe(3);
        expect(geometry.triangles.length).toBe(2 * 3);
        expect(geometry.segments[2]).toEqual([20, 10, 20, 0]);
        expect(geometry.textPosition).toEqual([20 + raise(SIZE), 5]);
        expect(geometry.textDirection).toEqual([0, -1]);
    });

    test("the label slides along the point→foot direction", () => {
        // p → foot runs (0,10) → (0,0), so along counts down from the point
        const geometry = pointLineDistanceDimension(
            [0, 10],
            [0, 0],
            [10, 0],
            { offset: 20, along: 4 },
            SIZE,
        )!;
        expect(geometry.textPosition).toEqual([20 + raise(SIZE), 6]);
        expect(geometry.segments[2]).toEqual([20, 10, 20, 0]); // the dimension line holds
    });

    test("returns undefined when the point is on the line", () => {
        expect(pointLineDistanceDimension([5, 0], [0, 0], [10, 0], { offset: 20 }, SIZE)).toBeUndefined();
    });

    test("negative offset keeps the extension lines on the same side — no crossing", () => {
        // foot = (0,0), direction p→foot = (0,-1), normal = (1,0); offset -20 puts
        // the dimension line at x = -20
        const geometry = pointLineDistanceDimension([0, 10], [0, 0], [10, 0], { offset: -20 }, SIZE)!;
        expect(geometry.segments[2]).toEqual([-20, 10, -20, 0]);
        for (const index of [0, 1]) {
            const segment = geometry.segments[index];
            expect(segment[0]).toBeCloseTo(-3, 9); // gap starts left of the point/foot
            expect(segment[2]).toBeLessThan(-20); // overshoots the dimension line
        }
    });

    test("returns undefined for a degenerate line", () => {
        expect(pointLineDistanceDimension([0, 10], [1, 1], [1, 1], { offset: 20 }, SIZE)).toBeUndefined();
    });
});

describe("signedSweep", () => {
    test("signs the sweep by the side of the first direction", () => {
        expect(signedSweep([1, 0], [0, 1])).toBeCloseTo(Math.PI / 2, 9);
        expect(signedSweep([1, 0], [0, -1])).toBeCloseTo(-Math.PI / 2, 9);
        // 180° → 270° wraps to a quarter turn the other way
        expect(signedSweep([-1, 0], [0, -1])).toBeCloseTo(Math.PI / 2, 9);
    });
});

describe("measuresSupplement", () => {
    // two lines 30° apart: narrow sectors of 30°, wide ones of 150°
    const d1: [number, number] = [1, 0];
    const d2 = at(30);

    test("a label in the measured sector keeps the angle, its facing sector too", () => {
        expect(measuresSupplement(d1, d2, at(15))).toBe(false);
        expect(measuresSupplement(d1, d2, at(195))).toBe(false);
    });

    test("a label in a wide sector takes the supplement", () => {
        expect(measuresSupplement(d1, d2, at(90))).toBe(true);
        expect(measuresSupplement(d1, d2, at(300))).toBe(true);
    });

    test("folds the same way for a clockwise angle", () => {
        const clockwise = at(-30);
        expect(measuresSupplement(d1, clockwise, at(-15))).toBe(false);
        expect(measuresSupplement(d1, clockwise, at(90))).toBe(true);
    });

    test("parallel directions cut no sectors to take a supplement from", () => {
        expect(measuresSupplement(d1, [2, 0], at(90))).toBe(false);
    });
});

describe("angleDimension", () => {
    test("arc clamped to the minimum radius, label on the sweep bisector", () => {
        const geometry = angleDimension([0, 0], [1, 0], Math.PI / 2, [10, 0], SIZE)!;
        expect(geometry).not.toBeNull();

        // 90° sweep → 8 arc segments; the two arrowheads are solid triangles
        expect(geometry.segments.length).toBe(8);
        expect(geometry.triangles.length).toBe(2 * 3);
        // arrow tips on the arc ends, at the clamped radius
        expect(Math.hypot(geometry.triangles[0][0], geometry.triangles[0][1])).toBeCloseTo(24, 9);
        expect(Math.hypot(geometry.triangles[3][0], geometry.triangles[3][1])).toBeCloseTo(24, 9);

        // label at 45° at distance 24 + 14
        expect(geometry.textPosition[0]).toBeCloseTo(38 * Math.SQRT1_2, 9);
        expect(geometry.textPosition[1]).toBeCloseTo(38 * Math.SQRT1_2, 9);
        // baseline along the clockwise tangent at the arc midpoint (45°)
        expect(geometry.textDirection[0]).toBeCloseTo(Math.SQRT1_2, 9);
        expect(geometry.textDirection[1]).toBeCloseTo(-Math.SQRT1_2, 9);
    });

    test("arc segment endpoints lie on the clamped circle", () => {
        const geometry = angleDimension([0, 0], [1, 0], Math.PI / 2, [10, 0], SIZE)!;
        for (const index of [0, 3, 7]) {
            const [x1, y1, x2, y2] = geometry.segments[index];
            expect(Math.hypot(x1, y1)).toBeCloseTo(24, 9);
            expect(Math.hypot(x2, y2)).toBeCloseTo(24, 9);
        }
    });

    test("sweeps the short way for a clockwise angle", () => {
        const geometry = angleDimension([0, 0], [1, 0], -Math.PI / 2, [10, 0], SIZE)!;
        expect(geometry.textPosition[0]).toBeCloseTo(38 * Math.SQRT1_2, 9);
        expect(geometry.textPosition[1]).toBeCloseTo(-38 * Math.SQRT1_2, 9);
    });

    test("draws on the side the label was placed, the same angle opposite the vertex", () => {
        const near = angleDimension([0, 0], [1, 0], Math.PI / 2, [-10, 0], SIZE)!;
        // label across the vertex → the arc moves to the 180°–270° sector
        expect(near.textPosition[0]).toBeCloseTo(-38 * Math.SQRT1_2, 9);
        expect(near.textPosition[1]).toBeCloseTo(-38 * Math.SQRT1_2, 9);
        // arrow tips sit there too, still on the clamped radius
        expect(Math.hypot(near.triangles[0][0], near.triangles[0][1])).toBeCloseTo(24, 9);
    });

    test("the arc sits at the label distance until the pixel minimum takes over", () => {
        // 100 world units out at 1 world unit/px, well past the 24 minimum
        const geometry = angleDimension([0, 0], [1, 0], Math.PI / 2, [100, 0], SIZE)!;
        expect(geometry.textPosition[0]).toBeCloseTo((100 + 14) * Math.SQRT1_2, 9);
        expect(geometry.textPosition[1]).toBeCloseTo((100 + 14) * Math.SQRT1_2, 9);
    });

    test("returns undefined for a zero-length direction or zero sweep", () => {
        expect(angleDimension([0, 0], [0, 0], Math.PI / 2, [10, 0], SIZE)).toBeUndefined();
        expect(angleDimension([0, 0], [1, 0], 0, [10, 0], SIZE)).toBeUndefined();
    });

    test("sweeps the supplement the stored direction carries", () => {
        // the 30° pair with its second direction reversed measures 150°; the label sits
        // at 135°, so the arc spans 30°–180° instead of 0°–30°
        const label: [number, number] = [
            100 * Math.cos((135 * Math.PI) / 180),
            100 * Math.sin((135 * Math.PI) / 180),
        ];
        const geometry = angleDimension([0, 0], [1, 0], (-5 * Math.PI) / 6, label, SIZE)!;

        // 150° → 14 arc segments at the 100-unit label distance, running from the
        // 180° ray down to the 30° ray
        expect(geometry.segments.length).toBe(14);
        const [x1, y1] = geometry.segments[0];
        expect(x1).toBeCloseTo(-100, 9);
        expect(y1).toBeCloseTo(0, 9);
        const [, , x2, y2] = geometry.segments[13];
        expect(x2).toBeCloseTo(100 * Math.cos(Math.PI / 6), 9);
        expect(y2).toBeCloseTo(100 * Math.sin(Math.PI / 6), 9);

        // the text sits past the arc on the 105° bisector
        expect(geometry.textPosition[0]).toBeCloseTo(114 * Math.cos((105 * Math.PI) / 180), 9);
        expect(geometry.textPosition[1]).toBeCloseTo(114 * Math.sin((105 * Math.PI) / 180), 9);
    });
});
