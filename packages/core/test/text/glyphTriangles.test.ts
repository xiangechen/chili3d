// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { Contour2D, FontOutline, GlyphOutline } from "../../src/text/fontOutline";
import {
    glyphTrianglesOf,
    layoutGlyphTriangles,
    layoutTextTriangles,
    triangulateGlyph,
} from "../../src/text/glyphTriangles";

const line = (x: number, y: number) => ({ kind: "line", to: { x, y } }) as const;

function contourOf(points: [number, number][]): Contour2D {
    const [start, ...rest] = points;
    return {
        start: { x: start[0], y: start[1] },
        segments: rest.map(([x, y]) => line(x, y)),
    };
}

/** Clockwise (y-up outer) square from (min,min) to (max,max); `reverse` flips the winding. */
function squareContour(min: number, max: number, reverse = false): Contour2D {
    const points: [number, number][] = [
        [min, min],
        [min, max],
        [max, max],
        [max, min],
        [min, min],
    ];
    return contourOf(reverse ? points.reverse() : points);
}

function glyphOf(contours: Contour2D[], advance = 600): GlyphOutline {
    return { advance, contours };
}

function triangleArea(triangles: Float32Array): number {
    let area = 0;
    for (let i = 0; i + 5 < triangles.length; i += 6) {
        const [x1, y1, x2, y2, x3, y3] = [...triangles.slice(i, i + 6)];
        area += Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) / 2;
    }
    return area;
}

/** Whether any triangle covers the point (triangulated regions do not overlap). */
function covers(triangles: Float32Array, px: number, py: number): boolean {
    for (let i = 0; i + 5 < triangles.length; i += 6) {
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

describe("triangulateGlyph", () => {
    test("triangulates a square into two triangles normalized to ems", () => {
        const geometry = triangulateGlyph(glyphOf([squareContour(0, 500)]), 1000);

        expect(geometry.triangles.length).toBe(12);
        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.25, 6);
        expect(geometry.advance).toBeCloseTo(0.6, 6);
    });

    test("cuts a nested contour out as a hole", () => {
        const geometry = triangulateGlyph(glyphOf([squareContour(0, 600), squareContour(250, 350)]), 1000);

        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.36 - 0.01, 5);
        expect(covers(geometry.triangles, 0.3, 0.3)).toBe(false);
    });

    test("fills every loop when none runs clockwise, rather than drawing nothing", () => {
        const geometry = triangulateGlyph(glyphOf([squareContour(0, 500, true)]), 1000);

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

    test("leaves a hole inside an island empty", () => {
        const geometry = triangulateGlyph(
            glyphOf([
                squareContour(0, 1000),
                squareContour(200, 800),
                squareContour(300, 700),
                squareContour(400, 600),
            ]),
            1000,
        );

        expect(covers(geometry.triangles, 0.5, 0.5)).toBe(false);
        expect(covers(geometry.triangles, 0.35, 0.5)).toBe(true);
        expect(covers(geometry.triangles, 0.25, 0.5)).toBe(false);
        expect(covers(geometry.triangles, 0.1, 0.5)).toBe(true);
    });

    test("ignores degenerate contours that triangulate to nothing", () => {
        const point: Contour2D = contourOf([
            [100, 100],
            [100, 100],
        ]);
        const geometry = triangulateGlyph(glyphOf([point, squareContour(0, 500)]), 1000);

        expect(triangleArea(geometry.triangles)).toBeCloseTo(0.25, 6);
    });
});

describe("layoutGlyphTriangles", () => {
    const glyph = triangulateGlyph(glyphOf([squareContour(0, 700)], 500), 1000);

    test("centers the line on the origin horizontally and on the ink vertically", () => {
        const positions = layoutGlyphTriangles("AA", () => glyph, 0.25);

        // two 0.5-advance glyphs centered: the ink (0.7 wide per glyph) spans [-0.5, 0.7]
        const xs = positions.filter((_, i) => i % 2 === 0);
        const ys = positions.filter((_, i) => i % 2 === 1);
        expect(Math.min(...xs)).toBeCloseTo(-0.5, 5);
        expect(Math.max(...xs)).toBeCloseTo(0.7, 5);
        expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 5);
    });

    test("a character without a glyph advances the missing width and draws nothing", () => {
        const positions = layoutGlyphTriangles(
            "A A",
            (codePoint) => (codePoint === 65 ? glyph : undefined),
            0.5,
        );

        const xs = [...positions].filter((_, i) => i % 2 === 0);
        // advance 0.5 + 0.5 missing + 0.5 centered → glyph origins at -0.75 and 0.25
        expect(Math.min(...xs)).toBeCloseTo(-0.75, 5);
        expect(Math.max(...xs)).toBeCloseTo(0.95, 5);
    });

    test("empty ink comes back as no triangles", () => {
        expect(layoutGlyphTriangles(" ", () => undefined, 0.25).length).toBe(0);
        expect(layoutGlyphTriangles("", () => glyph, 0.25).length).toBe(0);
    });
});

describe("glyphTrianglesOf / layoutTextTriangles", () => {
    const font = (glyphs: Record<number, GlyphOutline | undefined>): FontOutline => ({
        familyName: "test",
        unitsPerEm: 1000,
        missingAdvance: 250,
        glyph: (codePoint) => glyphs[codePoint],
    });

    test("caches the triangulation per font and code point", () => {
        const outline = font({ 65: glyphOf([squareContour(0, 700)]) });

        const first = glyphTrianglesOf(outline, 65);
        expect(first).toBeDefined();
        expect(glyphTrianglesOf(outline, 65)).toBe(first);
        expect(glyphTrianglesOf(outline, 66)).toBeUndefined();
    });

    test("lays a text out from the font's own glyphs and missing advance", () => {
        const outline = font({ 65: glyphOf([squareContour(0, 700)], 500) });

        const positions = layoutTextTriangles(outline, "A A");
        const xs = [...positions].filter((_, i) => i % 2 === 0);
        // advance 0.5 + 0.25 missing + 0.5 centered → glyph origins at -0.625 and 0.125
        expect(Math.min(...xs)).toBeCloseTo(-0.625, 5);
        expect(Math.max(...xs)).toBeCloseTo(0.825, 5);
    });
});
