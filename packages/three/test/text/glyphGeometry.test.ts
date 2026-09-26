// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Contour2D, GlyphOutline } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { layoutText, triangulateGlyph } from "../../src/text/glyphGeometry";

const line = (x: number, y: number) => ({ kind: "line", to: { x, y } }) as const;

function contourOf(points: [number, number][]): Contour2D {
    const [start, ...rest] = points;
    return {
        start: { x: start[0], y: start[1] },
        segments: rest.map(([x, y]) => line(x, y)),
    };
}

/** Clockwise (y-up outer) square from (0,0) to (size,size). */
function squareContour(size: number): Contour2D {
    return contourOf([
        [0, 0],
        [0, size],
        [size, size],
        [size, 0],
        [0, 0],
    ]);
}

function glyphOf(contours: Contour2D[], advance = 600): GlyphOutline {
    return { advance, contours };
}

function triangleArea(triangles: Float32Array): number {
    let area = 0;
    for (let i = 0; i < triangles.length; i += 6) {
        const [x1, y1, x2, y2, x3, y3] = [...triangles.slice(i, i + 6)];
        area += Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) / 2;
    }
    return area;
}

describe("triangulateGlyph", () => {
    test("triangulates a square into two triangles normalized to ems", () => {
        const geometry = triangulateGlyph(glyphOf([squareContour(500)]), 1000);

        expect(geometry.triangles.length).toBe(12);
        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.25, 6);
        expect(geometry.advance).toBeCloseTo(0.6, 6);
    });

    test("cuts a counter-clockwise contour out as a hole", () => {
        const geometry = triangulateGlyph(glyphOf([squareContour(600), offsetHole()]), 1000);

        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.36 - 0.01, 5);
    });

    test("fills every loop when none runs clockwise, rather than drawing nothing", () => {
        const reversed: Contour2D = contourOf([
            [0, 0],
            [500, 0],
            [500, 500],
            [0, 500],
            [0, 0],
        ]);
        const geometry = triangulateGlyph(glyphOf([reversed]), 1000);

        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.25, 5);
    });

    test("flattens curves instead of keeping control points as corners", () => {
        const contour: Contour2D = {
            start: { x: 0, y: 0 },
            segments: [
                { kind: "quad", c1: { x: 500, y: 500 }, to: { x: 1000, y: 0 } },
                line(500, -400),
                line(0, 0),
            ],
        };
        const geometry = triangulateGlyph(glyphOf([contour]), 1000);

        // the flattened arc bulges above its chord: well over the chord-only area
        // (0.2), and clearly below the control-point-as-corner area (0.45)
        expect(triangleArea(geometry.triangles)).toBeGreaterThan(0.3);
        expect(triangleArea(geometry.triangles)).toBeLessThan(0.4);
    });

    test("ignores degenerate contours that triangulate to nothing", () => {
        const point: Contour2D = contourOf([
            [100, 100],
            [100, 100],
        ]);
        const geometry = triangulateGlyph(glyphOf([point, squareContour(500)]), 1000);

        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.25, 6);
    });

    test("leaves a hole inside an island empty", () => {
        const geometry = triangulateGlyph(
            glyphOf([
                centeredSquare(0, 1000),
                centeredSquare(200, 800),
                centeredSquare(300, 700),
                centeredSquare(400, 600),
            ]),
            1000,
        );

        expect(covers(geometry.triangles, 0.5, 0.5)).toBe(false);
        expect(covers(geometry.triangles, 0.35, 0.5)).toBe(true);
        expect(covers(geometry.triangles, 0.25, 0.5)).toBe(false);
        expect(covers(geometry.triangles, 0.1, 0.5)).toBe(true);
    });

    test("sorts holes by nesting depth, not winding", () => {
        // 回 with every loop reversed: the ring stays a hole, the island stays ink
        const geometry = triangulateGlyph(
            glyphOf([
                centeredSquare(0, 1000, true),
                centeredSquare(200, 800, true),
                centeredSquare(300, 700, true),
            ]),
            1000,
        );

        expect(covers(geometry.triangles, 0.5, 0.5)).toBe(true);
        expect(covers(geometry.triangles, 0.25, 0.5)).toBe(false);
        expect(covers(geometry.triangles, 0.1, 0.5)).toBe(true);
    });
});

/** Clockwise square from (min,min) to (max,max); `reverse` flips the winding. */
function centeredSquare(min: number, max: number, reverse = false): Contour2D {
    const points: [number, number][] = [
        [min, min],
        [min, max],
        [max, max],
        [max, min],
        [min, min],
    ];
    return contourOf(reverse ? points.reverse() : points);
}

/** Whether any triangle covers the point (triangulated regions do not overlap). */
function covers(triangles: Float32Array, px: number, py: number): boolean {
    for (let i = 0; i < triangles.length; i += 6) {
        const [x1, y1, x2, y2, x3, y3] = [...triangles.slice(i, i + 6)];
        const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
        const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
        const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
        const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(hasNegative && hasPositive)) return true;
    }
    return false;
}

function offsetHole(): Contour2D {
    // Counter-clockwise (y-up hole) square from (250,250) to (350,350)
    return contourOf([
        [250, 250],
        [350, 250],
        [350, 350],
        [250, 350],
        [250, 250],
    ]);
}

describe("layoutText", () => {
    const glyph = triangulateGlyph(glyphOf([squareContour(700)], 500), 1000);

    test("centers the line on the origin horizontally and on the ink vertically", () => {
        const { positions } = layoutText("AA", () => glyph, 0.25);

        // two 0.5-advance glyphs centered: the ink (0.7 wide per glyph) spans [-0.5, 0.7]
        const xs = positions.filter((_, i) => i % 2 === 0);
        const ys = positions.filter((_, i) => i % 2 === 1);
        expect(Math.min(...xs)).toBeCloseTo(-0.5, 5);
        expect(Math.max(...xs)).toBeCloseTo(0.7, 5);
        expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 5);
    });

    test("a character without a glyph advances the missing width and draws nothing", () => {
        const laid = layoutText("A A", (codePoint) => (codePoint === 65 ? glyph : undefined), 0.5);

        const xs = [...laid.positions].filter((_, i) => i % 2 === 0);
        // advance 0.5 + 0.5 missing + 0.5 centered → glyph origins at -0.75 and 0.25
        expect(Math.min(...xs)).toBeCloseTo(-0.75, 5);
        expect(Math.max(...xs)).toBeCloseTo(0.95, 5);
    });

    test("empty ink comes back as no triangles", () => {
        expect(layoutText(" ", () => undefined, 0.25).positions.length).toBe(0);
        expect(layoutText("", () => glyph, 0.25).positions.length).toBe(0);
    });
});
