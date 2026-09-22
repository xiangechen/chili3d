// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FontOutline, GlyphOutline } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { layoutLine } from "../../src/text/layout";

const glyph = (advance: number): GlyphOutline => ({ advance, contours: [] });

/** A font whose every character is one of `advances`, and whose others are missing. */
function font(advances: Record<string, number>, missingAdvance = 600): FontOutline {
    return {
        familyName: "fake",
        unitsPerEm: 1000,
        missingAdvance,
        glyph: (codePoint) => {
            const advance = advances[String.fromCodePoint(codePoint)];
            return advance === undefined ? undefined : glyph(advance);
        },
    };
}

describe("layoutLine", () => {
    test("scales font units to millimetres", () => {
        const layout = layoutLine(font({ A: 500 }), "A", 20);

        expect(layout.scale).toBeCloseTo(0.02, 10);
        expect(layout.glyphs[0].advance).toBeCloseTo(10, 10);
    });

    test("places each glyph after the one before it", () => {
        const layout = layoutLine(font({ A: 500, B: 300 }), "AB", 10);

        expect(layout.glyphs.map((placed) => placed.offset)).toEqual([0, 5]);
        expect(layout.width).toBeCloseTo(8, 10);
    });

    test("reports a character the font lacks, and advances by the font's reserved width", () => {
        const layout = layoutLine(font({ A: 500 }, 400), "A中", 10);

        expect(layout.missing).toEqual([0x4e2d]);
        expect(layout.glyphs[1].glyph).toBeUndefined();
        expect(layout.glyphs[1].advance).toBeCloseTo(4, 10);
        expect(layout.width).toBeCloseTo(9, 10);
    });

    test("treats a character outside the basic plane as one glyph", () => {
        const layout = layoutLine(font({ "\u{1f600}": 900 }), "\u{1f600}", 10);

        expect(layout.glyphs.length).toBe(1);
        expect(layout.glyphs[0].codePoint).toBe(0x1f600);
        expect(layout.glyphs[0].glyph).not.toBeUndefined();
    });

    test("empty text lays out nothing", () => {
        const layout = layoutLine(font({}), "", 10);

        expect(layout.glyphs).toEqual([]);
        expect(layout.width).toBe(0);
        expect(layout.missing).toEqual([]);
    });

    test("a space advances the pen without drawing anything", () => {
        const layout = layoutLine(font({ " ": 250 }), " ", 10);

        expect(layout.glyphs[0].glyph?.contours).toEqual([]);
        expect(layout.glyphs[0].advance).toBeCloseTo(2.5, 10);
        expect(layout.missing).toEqual([]);
    });
});
