// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type FontOutline, type GlyphOutline, type IShape, Plane, Result, type XYZ } from "@chili3d/core";
import { createMockShape, setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { textShape, textSolid } from "../../src/text/textSolid";

/** A bar as a glyph loop, given its corners. */
function bar(x1: number, y1: number, x2: number, y2: number) {
    return {
        start: { x: x1, y: y1 },
        segments: [
            { kind: "line" as const, to: { x: x2, y: y1 } },
            { kind: "line" as const, to: { x: x2, y: y2 } },
            { kind: "line" as const, to: { x: x1, y: y2 } },
            { kind: "line" as const, to: { x: x1, y: y1 } },
        ],
    };
}

const glyph = (contours: GlyphOutline["contours"]): GlyphOutline => ({ advance: 600, contours });

/**
 * A font of three glyphs, one per case these tests care about:
 * `A` is two bars that cross (a glyph's strokes, as a font states them), `B` two
 * bars that stand apart, `C` a single region.
 */
function fontOf(): FontOutline {
    const shapes: Record<string, GlyphOutline> = {
        A: glyph([bar(100, 400, 900, 500), bar(450, 100, 550, 900)]),
        B: glyph([bar(100, 100, 300, 900), bar(700, 100, 900, 900)]),
        C: glyph([bar(100, 100, 900, 900)]),
    };

    return {
        familyName: "fake",
        unitsPerEm: 1000,
        missingAdvance: 500,
        glyph: (codePoint) => shapes[String.fromCodePoint(codePoint)],
    };
}

/** A factory that records the work the build asks for. */
function spyFactory() {
    const spies = {
        combine: rs.fn((_shapes: IShape[]): Result<IShape> => Result.ok(createMockShape())),
        prism: rs.fn((_shape: IShape, _vec: XYZ): Result<IShape> => Result.ok(createMockShape())),
        booleanFuse: rs.fn(
            (_first: IShape[], _rest: IShape[], _simplify: boolean): Result<IShape> =>
                Result.ok(createMockShape()),
        ),
    };

    setupShapeFactoryMock({
        line: () => Result.ok(createMockShape()),
        wire: () => Result.ok(createMockShape()),
        face: () => Result.ok(createMockShape()),
        ...spies,
    });
    return spies;
}

const options = { size: 10, depth: 2, plane: Plane.XY };
const solidOf = (text: string) => textSolid(fontOf(), { ...options, text });

beforeEach(() => {
    rs.restoreAllMocks();
});

describe("textShape", () => {
    test("groups a glyph's overlapping regions as one piece", () => {
        spyFactory();

        // `A` is two bars that cross, so the two regions are one solid's worth.
        const shape = textShape(fontOf(), { ...options, text: "A" });

        expect(shape.isOk).toBe(true);
        expect(shape.value.pieces.length).toBe(1);
        expect(shape.value.pieces[0].length).toBe(2);
    });

    test("keeps regions that do not overlap as pieces of their own", () => {
        spyFactory();

        const shape = textShape(fontOf(), { ...options, text: "B" });

        expect(shape.value.pieces.length).toBe(2);
        expect(shape.value.pieces.map((piece) => piece.length)).toEqual([1, 1]);
    });

    test("combines every piece for a caller that draws the text flat", () => {
        const spies = spyFactory();

        textShape(fontOf(), { ...options, text: "ABC" });

        expect(spies.combine.mock.calls.length).toBe(1);
        expect(spies.combine.mock.calls[0][0].length).toBe(5);
    });
});

describe("textSolid", () => {
    test("fuses the regions that overlap, and only those", () => {
        const spies = spyFactory();

        const result = solidOf("ABC");

        expect(result.isOk).toBe(true);
        // `A`'s bars cross, so they are one body: fused before they are extruded,
        // which is where a seam between them would otherwise be.
        expect(spies.booleanFuse.mock.calls.length).toBe(1);
        expect(spies.booleanFuse.mock.calls[0][0].length).toBe(1);
        expect(spies.booleanFuse.mock.calls[0][1].length).toBe(1);
        // A body per solid, then one extrude of the lot: the line is a compound of
        // bodies, not a body per glyph.
        expect(spies.combine.mock.calls[1][0].length).toBe(4);
        expect(spies.prism.mock.calls.length).toBe(1);
    });

    test("does no boolean work for a line whose glyphs do not overlap", () => {
        const spies = spyFactory();

        solidOf("BC");

        // Latin text arrives as one region per glyph, so fusing is nothing it needs.
        expect(spies.booleanFuse.mock.calls.length).toBe(0);
        expect(spies.prism.mock.calls.length).toBe(1);
    });

    test("draws a glyph the kernel will not fuse rather than losing the line", () => {
        const spies = spyFactory();
        spies.booleanFuse.mockReturnValue(Result.err("Fuse Error"));

        const result = solidOf("A");

        // The regions are handed on as they are: a seam is better than no text.
        expect(result.isOk).toBe(true);
        expect(spies.prism.mock.calls.length).toBe(1);
    });

    test("reports text with nothing to draw rather than an empty shape", () => {
        spyFactory();

        expect(solidOf("").isOk).toBe(false);
        expect(solidOf("XYZ").isOk).toBe(false);
    });
});
