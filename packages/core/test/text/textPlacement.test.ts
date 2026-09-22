// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger, Plane, XYZ } from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import type { TextLayout } from "../../src/text/layout";
import type { PathFrames } from "../../src/text/pathFrames";
import { pathPlacement, planarPlacement } from "../../src/text/textPlacement";

function layoutOf(offsets: number[], width: number, scale = 0.1): TextLayout {
    return {
        scale,
        width,
        missing: [],
        glyphs: offsets.map((offset) => ({ codePoint: 65, glyph: undefined, offset, advance: 0 })),
    };
}

/** A straight path lying along +x, so the expected positions are trivial. */
function straightFrames(length: number): PathFrames {
    return {
        length,
        normal: XYZ.unitZ,
        at: (abscissa) => ({
            point: new XYZ({ x: abscissa, y: 0, z: 0 }),
            tangent: XYZ.unitX,
            up: XYZ.unitY,
        }),
    };
}

describe("planarPlacement", () => {
    const plane = Plane.XY;

    test("starts the baseline at the plane's origin", () => {
        const placement = planarPlacement(plane, layoutOf([0], 10));

        expect(placement.glyphs[0]({ x: 0, y: 0 })).toEqual(XYZ.zero);
    });

    test("scales the glyph to millimetres and lays it on the plane's axes", () => {
        const placement = planarPlacement(plane, layoutOf([0], 10, 0.1));

        expect(placement.glyphs[0]({ x: 100, y: 50 })).toEqual(new XYZ({ x: 10, y: 5, z: 0 }));
    });

    test("offsets each glyph along the plane's x axis", () => {
        const placement = planarPlacement(plane, layoutOf([0, 20], 30, 0.1));

        expect(placement.glyphs[1]({ x: 0, y: 0 })).toEqual(new XYZ({ x: 20, y: 0, z: 0 }));
    });

    test("extrudes along the plane's normal", () => {
        const tilted = new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY });

        expect(planarPlacement(tilted, layoutOf([0], 10)).direction).toEqual(XYZ.unitX);
    });
});

describe("pathPlacement", () => {
    test("centres the line on the path", () => {
        const placement = pathPlacement(straightFrames(100), layoutOf([0, 50], 50, 0.1));

        expect(placement.isOk).toBe(true);
        // 100 long, 50 of text: the line starts at 25.
        expect(placement.value.glyphs[0]({ x: 0, y: 0 })).toEqual(new XYZ({ x: 25, y: 0, z: 0 }));
        expect(placement.value.glyphs[1]({ x: 0, y: 0 })).toEqual(new XYZ({ x: 75, y: 0, z: 0 }));
    });

    test("turns each glyph with the path", () => {
        const placement = pathPlacement(straightFrames(100), layoutOf([25], 50, 0.1));

        // The glyph's origin sits at 25 of centring plus its 25 of offset; a
        // point one em to its right and one em up lands 100 further along both.
        const world = placement.value.glyphs[0]({ x: 1000, y: 1000 });

        expect(world.x).toBeCloseTo(150, 6);
        expect(world.y).toBeCloseTo(100, 6);
    });

    test("extrudes along the path's plane normal", () => {
        expect(pathPlacement(straightFrames(100), layoutOf([0], 10)).value.direction).toEqual(XYZ.unitZ);
    });

    test("draws text wider than the path on past its end", () => {
        const warn = rs.spyOn(Logger, "warn");
        const placement = pathPlacement(straightFrames(40), layoutOf([0, 60], 70));

        // Losing the whole line would say less than showing the part that does not fit: it
        // begins at the path's own start and reads on, and the log says why.
        expect(placement.isOk).toBe(true);
        expect(placement.value.glyphs[0]({ x: 0, y: 0 })).toEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(placement.value.glyphs[1]({ x: 0, y: 0 })).toEqual(new XYZ({ x: 60, y: 0, z: 0 }));
        expect(warn.mock.calls.length).toBe(1);
        expect(String(warn.mock.calls[0][0])).toContain("past the end");

        rs.restoreAllMocks();
    });

    test("refuses a path with no direction where a glyph would sit", () => {
        const frames: PathFrames = { length: 100, normal: XYZ.unitZ, at: () => undefined };

        const placement = pathPlacement(frames, layoutOf([0], 10));

        expect(placement.isOk).toBe(false);
        expect(placement.error).toContain("no direction");
    });
});
