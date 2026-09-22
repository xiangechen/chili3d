// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { nestLoops, type Polygon, pointInPolygon } from "../src/math/polygon";

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
