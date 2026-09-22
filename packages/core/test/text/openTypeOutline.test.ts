// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { GlyphOutline, Segment2D, Vec2 } from "../../src/text/fontOutline";
import { cacheOfOutline, codePointsOf, outlineFromCache } from "../../src/text/fontOutline";
import type { OpenTypeCommand, OpenTypeFont } from "../../src/text/openTypeModule";
import { familyNameOf, outlineFromOpenType } from "../../src/text/openTypeOutline";

/**
 * A font stands in for opentype.js's parse result, so these tests state the
 * command semantics directly instead of reading them off a font file. It takes
 * the same shapes the library does — a character *string* to `charToGlyph`, and
 * glyphs by index for `.notdef` — so a call the real library would reject fails
 * here too.
 */
function fakeFont(
    glyphs: Record<string, { index: number; advanceWidth: number; commands: OpenTypeCommand[] }>,
    options: { unitsPerEm?: number; names?: OpenTypeFont["names"] } = {},
): OpenTypeFont {
    const at = (key: string) => {
        const glyph = glyphs[key] ?? glyphs["\u0000"];
        return {
            index: glyph.index,
            advanceWidth: glyph.advanceWidth,
            path: { commands: glyph.commands },
        };
    };
    return {
        unitsPerEm: options.unitsPerEm ?? 1000,
        names: options.names,
        // A string, as opentype.js takes it: a number here would be a bug the real
        // library reports as `codePointAt is not a function`.
        charToGlyph: (character: string) => at(character),
        glyphs: { get: (index: number) => at(index === 0 ? "\u0000" : String.fromCodePoint(index)) },
    };
}

const notdef = { index: 0, advanceWidth: 600, commands: [] as OpenTypeCommand[] };

function fontWith(commands: OpenTypeCommand[], advanceWidth = 1000, unitsPerEm = 1000) {
    return fakeFont({ "\u0000": notdef, A: { index: 1, advanceWidth, commands } }, { unitsPerEm });
}

const segmentKinds = (glyph: GlyphOutline) => glyph.contours.flatMap((c) => c.segments.map((s) => s.kind));

describe("contours — splitting and closing", () => {
    test("each M starts a contour", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "Z" },
            { type: "M", x: 50, y: 50 },
            { type: "L", x: 60, y: 50 },
            { type: "Z" },
        ]);

        const glyph = outlineFromOpenType(font, "fake").glyph(65);

        expect(glyph?.contours.length).toBe(2);
        expect(glyph?.contours[0].start).toEqual({ x: 0, y: 0 });
        expect(glyph?.contours[1].start).toEqual({ x: 50, y: 50 });
    });

    test("Z closes a contour whose end is not its start", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "L", x: 10, y: 10 },
            { type: "Z" },
        ]);

        const segments = outlineFromOpenType(font, "fake").glyph(65)!.contours[0].segments;

        expect(segments).toEqual([
            { kind: "line", to: { x: 10, y: 0 } },
            { kind: "line", to: { x: 10, y: 10 } },
            { kind: "line", to: { x: 0, y: 0 } },
        ]);
    });

    test("Z adds no segment when the contour already returned to its start", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "L", x: 0, y: 0 },
            { type: "Z" },
        ]);

        const segments = outlineFromOpenType(font, "fake").glyph(65)!.contours[0].segments;

        expect(segments.length).toBe(2);
    });

    test("a contour left unclosed still gets its closing line", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "L", x: 10, y: 10 },
        ]);

        const segments = outlineFromOpenType(font, "fake").glyph(65)!.contours[0].segments;

        expect(segments.at(-1)).toEqual({ kind: "line", to: { x: 0, y: 0 } });
    });

    test("a contour with no segments is dropped", () => {
        const font = fontWith([
            { type: "M", x: 5, y: 5 },
            { type: "Z" },
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
        ]);

        const glyph = outlineFromOpenType(font, "fake").glyph(65);

        expect(glyph?.contours.length).toBe(1);
        expect(glyph?.contours[0].start).toEqual({ x: 0, y: 0 });
    });

    test("a segment whose ends coincide is dropped", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "L", x: 10, y: 0 },
            { type: "Z" },
        ]);

        const glyph = outlineFromOpenType(font, "fake").glyph(65);

        expect(glyph?.contours[0].segments.length).toBe(2);
    });
});

describe("segments — curves keep their control points", () => {
    test("Q becomes a quadratic segment", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "Q", x1: 5, y1: 10, x: 10, y: 0 },
        ]);

        const segments = outlineFromOpenType(font, "fake").glyph(65)!.contours[0].segments;

        expect(segments).toEqual([
            { kind: "quad", c1: { x: 5, y: 10 }, to: { x: 10, y: 0 } },
            { kind: "line", to: { x: 0, y: 0 } },
        ]);
    });

    test("C becomes a cubic segment", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "C", x1: 2, y1: 10, x2: 8, y2: 10, x: 10, y: 0 },
        ]);

        const segments = outlineFromOpenType(font, "fake").glyph(65)!.contours[0].segments;

        expect(segments[0]).toEqual({
            kind: "cubic",
            c1: { x: 2, y: 10 },
            c2: { x: 8, y: 10 },
            to: { x: 10, y: 0 },
        });
    });

    test("both curve kinds survive in one contour", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "Q", x1: 5, y1: 10, x: 10, y: 0 },
            { type: "C", x1: 12, y1: 10, x2: 18, y2: 10, x: 20, y: 0 },
        ]);

        const glyph = outlineFromOpenType(font, "fake").glyph(65)!;

        expect(segmentKinds(glyph)).toEqual(["quad", "cubic", "line"]);
    });

    test("y is not flipped: a glyph above the baseline stays above it", () => {
        const font = fontWith([
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 0, y: 700 },
        ]);

        const glyph = outlineFromOpenType(font, "fake").glyph(65);
        const ys = glyph!.contours[0].segments.map((s: Segment2D) => (s as { to: Vec2 }).to.y);

        expect(ys).toEqual([700, 0]);
    });
});

describe("font metrics", () => {
    test("advance comes from the glyph", () => {
        const font = fontWith([{ type: "M", x: 0, y: 0 }], 1234);

        expect(outlineFromOpenType(font, "fake").glyph(65)?.advance).toBe(1234);
    });

    test("unitsPerEm comes from the font", () => {
        const font = fontWith([{ type: "M", x: 0, y: 0 }], 1000, 2048);

        expect(outlineFromOpenType(font, "fake").unitsPerEm).toBe(2048);
    });

    test("missingAdvance is the .notdef advance", () => {
        const font = fontWith([{ type: "M", x: 0, y: 0 }]);

        expect(outlineFromOpenType(font, "fake").missingAdvance).toBe(600);
    });

    test("a character the font lacks is reported missing, not drawn as .notdef", () => {
        const font = fakeFont({ "\u0000": { ...notdef, commands: [] } });

        const outline = outlineFromOpenType(font, "fake");

        expect(outline.glyph(0x4e2d)).toBeUndefined();
    });
});

describe("family name", () => {
    test("prefers the unicode name table", () => {
        const font = fakeFont(
            {},
            { names: { windows: { fontFamily: { en: "Win" } }, unicode: { fontFamily: { en: "Uni" } } } },
        );

        expect(familyNameOf(font)).toBe("Uni");
    });

    test("falls back to another platform when unicode is absent", () => {
        const font = fakeFont({}, { names: { windows: { fontFamily: { en: "Win" } } } });

        expect(familyNameOf(font)).toBe("Win");
    });

    test("reports nothing when the font states no family name", () => {
        expect(familyNameOf(fakeFont({}))).toBeUndefined();
    });
});

describe("outline cache", () => {
    test("round-trips the glyphs a document used", () => {
        const font = fontWith([{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "Z" }]);
        const outline = outlineFromOpenType(font, "fake");

        const cache = JSON.parse(JSON.stringify(cacheOfOutline(outline, [65])));
        const restored = outlineFromCache(cache);

        expect(restored.familyName).toBe("fake");
        expect(restored.unitsPerEm).toBe(1000);
        expect(restored.missingAdvance).toBe(600);
        expect(restored.glyph(65)).toEqual(outline.glyph(65));
    });

    test("stores only the code points it was asked for", () => {
        const font = fakeFont({
            "\u0000": notdef,
            A: { index: 1, advanceWidth: 1000, commands: [{ type: "M", x: 0, y: 0 }] },
            B: { index: 2, advanceWidth: 1000, commands: [{ type: "M", x: 0, y: 0 }] },
        });

        const cache = cacheOfOutline(outlineFromOpenType(font, "fake"), [65]);

        expect(Object.keys(cache.glyphs)).toEqual(["65"]);
    });

    test("codePointsOf lists each code point once, in order", () => {
        expect(codePointsOf("aba\u{1f600}a")).toEqual([0x61, 0x62, 0x1f600]);
    });
});
