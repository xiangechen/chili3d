// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Contour2D, Vec2 } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { flattenContour, groupContours } from "../../src/text/contourRegions";

/** A contour through the given points, closed back to the first as a font states it. */
function loop(points: Vec2[]): Contour2D {
    return {
        start: points[0],
        segments: [
            ...points.slice(1).map((point) => ({ kind: "line" as const, to: point })),
            { kind: "line", to: points[0] },
        ],
    };
}

const rect = (x: number, y: number, size: number) =>
    loop([
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
    ]);

describe("flattenContour", () => {
    test("keeps the corners of a straight contour", () => {
        expect(flattenContour(rect(0, 0, 10))).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
        ]);
    });

    test("walks a curve out to its control point's side", () => {
        const arc = flattenContour({
            start: { x: 0, y: 0 },
            segments: [
                { kind: "quad", c1: { x: 5, y: 10 }, to: { x: 10, y: 0 } },
                { kind: "line", to: { x: 0, y: 0 } },
            ],
        });

        const peak = Math.max(...arc.map((point) => point.y));

        // A quadratic reaches half its control point's height at the midpoint.
        expect(peak).toBeCloseTo(5, 6);
    });
});

describe("groupContours", () => {
    test("a lone loop is one region with no holes", () => {
        expect(groupContours([rect(0, 0, 100)])).toEqual([[{ outer: 0, holes: [] }]]);
    });

    test("a loop inside a loop is a hole", () => {
        expect(groupContours([rect(0, 0, 100), rect(25, 25, 50)])).toEqual([[{ outer: 0, holes: [1] }]]);
    });

    test("disjoint loops are separate regions", () => {
        expect(groupContours([rect(0, 0, 10), rect(100, 100, 10)])).toEqual([
            [{ outer: 0, holes: [] }],
            [{ outer: 1, holes: [] }],
        ]);
    });

    test("a hole in a hole is a filled island of its own", () => {
        const groups = groupContours([rect(0, 0, 100), rect(20, 20, 60), rect(40, 40, 20)]);

        expect(groups).toEqual([[{ outer: 0, holes: [1] }], [{ outer: 2, holes: [] }]]);
    });

    test("a hole inside an island belongs to the island", () => {
        const groups = groupContours([rect(0, 0, 100), rect(20, 20, 60), rect(40, 40, 20), rect(45, 45, 10)]);

        expect(groups).toEqual([[{ outer: 0, holes: [1] }], [{ outer: 2, holes: [3] }]]);
    });

    test("a hole touching its region at a corner is still a hole", () => {
        // The counter of a glyph whose stroke meets the outer box at a corner.
        const touching = loop([
            { x: 0, y: 0 },
            { x: 40, y: 10 },
            { x: 10, y: 40 },
        ]);

        expect(groupContours([rect(0, 0, 100), touching])).toEqual([[{ outer: 0, holes: [1] }]]);
    });

    test("loops that cross each other are separate regions, not holes", () => {
        // How a font states a CJK glyph: its strokes are separate loops that meet.
        // `田` is a three-sided box crossed by two bars — reading the crossings as
        // holes is what turned it into a doubled-up solid.
        const across = loop([
            { x: 0, y: 40 },
            { x: 100, y: 40 },
            { x: 100, y: 60 },
            { x: 0, y: 60 },
        ]);
        const down = loop([
            { x: 40, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 100 },
            { x: 40, y: 100 },
        ]);

        expect(groupContours([across, down])).toEqual([
            [
                { outer: 0, holes: [] },
                { outer: 1, holes: [] },
            ],
        ]);
    });

    test("a hole is still a hole when a stroke crosses the region it is in", () => {
        // `中`: a counter inside the box, and a bar running through both.
        const counter = loop([
            { x: 30, y: 30 },
            { x: 70, y: 30 },
            { x: 70, y: 70 },
            { x: 30, y: 70 },
        ]);
        const box = loop([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ]);
        const bar = loop([
            { x: 45, y: -20 },
            { x: 55, y: -20 },
            { x: 55, y: 120 },
            { x: 45, y: 120 },
        ]);

        // The counter is enclosed by the box and stays a hole; the bar crosses the
        // box, so it is a region of its own rather than a hole in it — and the two of
        // them overlap, so they are one solid.
        expect(groupContours([box, counter, bar])).toEqual([
            [
                { outer: 0, holes: [1] },
                { outer: 2, holes: [] },
            ],
        ]);
    });

    test("loops touching only at a corner are separate solids", () => {
        expect(groupContours([rect(0, 0, 10), rect(10, 10, 10)])).toEqual([
            [{ outer: 0, holes: [] }],
            [{ outer: 1, holes: [] }],
        ]);
    });

    test("a region that overlaps nothing stays a solid of its own", () => {
        // The dot of an `i`: apart from the stem, so apart from it as a solid.
        expect(groupContours([rect(0, 0, 100), rect(500, 500, 20)])).toEqual([
            [{ outer: 0, holes: [] }],
            [{ outer: 1, holes: [] }],
        ]);
    });

    test("regions overlapping through a third are one solid", () => {
        // Two bars, too far apart to reach each other, and one across both: what the
        // third joins is one shape, so all three have to be fused in one go.
        const across = loop([
            { x: 0, y: 50 },
            { x: 300, y: 50 },
            { x: 300, y: 70 },
            { x: 0, y: 70 },
        ]);

        expect(groupContours([rect(10, 40, 100), rect(200, 40, 100), across])).toEqual([
            [
                { outer: 0, holes: [] },
                { outer: 1, holes: [] },
                { outer: 2, holes: [] },
            ],
        ]);
    });
});
