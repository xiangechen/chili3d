// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { nestLoops, type Polygon, pointInPolygon, triangulatePolygon } from "../src/math/polygon";

const square = (x: number, y: number, size: number): Polygon => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
];

describe("pointInPolygon", () => {
    const unit = square(0, 0, 10);

    test("reports a point inside", () => {
        expect(pointInPolygon([5, 5], unit)).toBe(true);
    });

    test("reports a point outside", () => {
        expect(pointInPolygon([15, 5], unit)).toBe(false);
    });

    test("reports a point beyond the far side", () => {
        expect(pointInPolygon([-1, 5], unit)).toBe(false);
    });

    test("a vertex at the point's own height does not read inside-out", () => {
        // Both lower corners sit exactly at y = 0, so the ray grazes two vertices.
        // Counting each of them once is what keeps the lower half outside.
        expect(pointInPolygon([5, -1], unit)).toBe(false);
        expect(pointInPolygon([5, 1], unit)).toBe(true);
    });

    test("a point level with the top edge is outside", () => {
        expect(pointInPolygon([5, 10], unit)).toBe(false);
    });
});

describe("nestLoops", () => {
    /** Containment by bounds, enough to tell the cases below apart. */
    const encloses = (outer: Polygon, inner: Polygon) =>
        inner.every(
            ([x, y]) =>
                x > Math.min(...outer.map((p) => p[0])) &&
                x < Math.max(...outer.map((p) => p[0])) &&
                y > Math.min(...outer.map((p) => p[1])) &&
                y < Math.max(...outer.map((p) => p[1])),
        );

    const nest = (loops: Polygon[]) =>
        nestLoops(loops.length, (outer, inner) => encloses(loops[outer], loops[inner]));

    test("loops standing apart are all at depth zero", () => {
        expect(nest([square(0, 0, 10), square(100, 100, 10)]).depth).toEqual([0, 0]);
    });

    test("a loop inside a loop is one deep", () => {
        expect(nest([square(0, 0, 100), square(25, 25, 50)]).depth).toEqual([0, 1]);
    });

    test("a loop inside a hole is two deep, which makes it filled again", () => {
        expect(nest([square(0, 0, 100), square(20, 20, 60), square(40, 40, 20)]).depth).toEqual([0, 1, 2]);
    });

    test("says which loops are filled regions and which are holes", () => {
        // A ring inside a ring: the middle loop is a hole, the innermost is filled again.
        const nesting = nest([square(0, 0, 100), square(20, 20, 60), square(40, 40, 20)]);

        expect(nesting.filled).toEqual([0, 2]);
        expect(nesting.holes).toEqual([1]);
    });

    test("says which loops a region encloses directly", () => {
        const nesting = nest([square(0, 0, 100), square(20, 20, 60), square(40, 40, 20)]);

        // The innermost is inside the middle loop, not the outer one, so only the
        // middle loop has it as a child.
        expect(nesting.children).toEqual([[1], [2], []]);
    });

    test("a lone loop encloses nothing", () => {
        expect(nest([square(0, 0, 10)]).children).toEqual([[]]);
    });
});

describe("triangulatePolygon", () => {
    const areaOf = (triangles: [number, number][]) => {
        let area = 0;
        for (let i = 0; i + 2 < triangles.length; i += 3) {
            const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
            area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
        }
        return area;
    };

    test("a square becomes two triangles covering it", () => {
        const triangles = triangulatePolygon(square(0, 0, 10));
        expect(triangles.length).toBe(2 * 3);
        expect(areaOf(triangles)).toBeCloseTo(100, 9);
    });

    test("a repeated closing point and a reversed winding are cleaned up", () => {
        const closed: Polygon = [...square(0, 0, 10), [0, 0]];
        expect(triangulatePolygon(closed).length).toBe(2 * 3);
        expect(areaOf(triangulatePolygon([...square(0, 0, 10)].reverse()))).toBeCloseTo(100, 9);
    });

    test("a concave polygon covers exactly its own area", () => {
        // an L: 10x10 square with the upper-right quarter missing
        const l: Polygon = [
            [0, 0],
            [10, 0],
            [10, 5],
            [5, 5],
            [5, 10],
            [0, 10],
        ];
        const triangles = triangulatePolygon(l);
        expect(areaOf(triangles)).toBeCloseTo(75, 9);
        // the missing quarter stays empty: no triangle covers its center
        expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, [7.5, 7.5]))).toBe(false);
    });

    test("a square with a square hole leaves the hole empty", () => {
        const triangles = triangulatePolygon(square(0, 0, 10), [square(3, 3, 4)]);
        expect(areaOf(triangles)).toBeCloseTo(100 - 16, 9);
        expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, [5, 5]))).toBe(false);
        expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, [1, 5]))).toBe(true);
    });

    test("two holes side by side both stay empty", () => {
        const triangles = triangulatePolygon(square(0, 0, 20), [square(2, 8, 4), square(14, 8, 4)]);
        expect(areaOf(triangles)).toBeCloseTo(400 - 32, 9);
        expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, [4, 10]))).toBe(false);
        expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, [16, 10]))).toBe(false);
    });

    // Holes at different heights: a later hole's bridge channel must neither land on
    // a previous channel's endpoint (a vertex already twice on the ring) nor cross
    // a previous channel or a hole still waiting for its own — each variant below
    // produced triangles covering a hole before (area well past the frame at worst).
    test.each([
        {
            name: "the lower hole's channel triangle holds the upper hole's top",
            holes: [square(9, 10, 4), square(4, 2, 4)],
            probes: [
                [11, 12],
                [6, 4],
            ] as [number, number][],
            area: 400 - 16 - 16,
        },
        {
            name: "a small upper hole above a larger lower one",
            holes: [square(9, 10, 2), square(4, 2, 4)],
            probes: [
                [10, 11],
                [6, 4],
            ] as [number, number][],
            area: 400 - 4 - 16,
        },
        {
            name: "vertically aligned holes, the lower one bridging to the upper one's corner",
            holes: [square(8, 12, 4), square(8, 2, 4)],
            probes: [
                [10, 14],
                [10, 4],
            ] as [number, number][],
            area: 400 - 16 - 16,
        },
        {
            name: "three holes low in the frame, an early channel passing over a later hole",
            holes: [square(9.859, 1.283, 3.443), square(13.642, 1.576, 3.28), square(4.32, 3.263, 5.065)],
            probes: [
                [9.859 + 3.443 / 2, 1.283 + 3.443 / 2],
                [13.642 + 3.28 / 2, 1.576 + 3.28 / 2],
                [4.32 + 5.065 / 2, 3.263 + 5.065 / 2],
            ] as [number, number][],
            area: 400 - 3.443 ** 2 - 3.28 ** 2 - 5.065 ** 2,
        },
    ])("holes at different heights stay empty: $name", ({ holes, probes, area }) => {
        const triangles = triangulatePolygon(square(0, 0, 20), holes);
        expect(areaOf(triangles)).toBeCloseTo(area, 9);
        expect(probes.length).toBe(holes.length);
        for (const probe of probes) {
            expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, probe))).toBe(false);
        }
    });

    test("a hole whose top point sits below an outer vertex bridges cleanly", () => {
        // the hole's top is level with nothing: the vertical channel meets an edge
        const triangles = triangulatePolygon(square(0, 0, 10), [
            [
                [2, 2],
                [5, 2],
                [5, 5],
                [2, 5],
            ],
        ]);
        expect(areaOf(triangles)).toBeCloseTo(100 - 9, 9);
        expect(triangles.some((_, i) => i % 3 === 0 && pointInEar(triangles, i, [3.5, 3.5]))).toBe(false);
    });

    test("degenerate rings produce nothing", () => {
        expect(triangulatePolygon([[1, 1]])).toEqual([]);
        expect(
            triangulatePolygon([
                [0, 0],
                [1, 0],
                [0, 0],
            ]),
        ).toEqual([]);
    });
});

/** Whether the ear starting at corner index `start` covers the point (boundary excluded). */
function pointInEar(triangles: [number, number][], start: number, [px, py]: [number, number]): boolean {
    const [a, b, c] = [triangles[start], triangles[start + 1], triangles[start + 2]];
    const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
    const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNegative && hasPositive);
}
