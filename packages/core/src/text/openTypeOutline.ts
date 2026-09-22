// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";
import type { Contour2D, FontOutline, GlyphOutline, Segment2D, Vec2 } from "./fontOutline";
import type { OpenTypeCommand, OpenTypeFont, OpenTypeGlyph } from "./openTypeModule";

const samePoint = (a: Vec2, b: Vec2) =>
    Math.abs(a.x - b.x) < Precision.Distance && Math.abs(a.y - b.y) < Precision.Distance;

/**
 * Read a parsed opentype.js font as outlines. A character the font has no glyph
 * for comes back as `.notdef` — glyph 0 — and is reported as missing rather than
 * drawn, so a gap in the text does not turn into a row of empty boxes.
 */
export function outlineFromOpenType(font: OpenTypeFont, familyName: string): FontOutline {
    // `.notdef` carries the width a font reserves for a character it lacks.
    const notdef = font.glyphs.get(0);
    return {
        familyName,
        unitsPerEm: font.unitsPerEm,
        missingAdvance: notdef.advanceWidth ?? 0,
        glyph: (codePoint) => {
            const glyph = font.charToGlyph(String.fromCodePoint(codePoint));
            return glyph.index === 0 ? undefined : glyphOutlineOf(glyph);
        },
    };
}

/** The family name a font states for itself, preferring the unicode name table. */
export function familyNameOf(font: OpenTypeFont): string | undefined {
    const names = font.names;
    if (names === undefined) return undefined;
    for (const platform of ["unicode", "windows", "macintosh"] as const) {
        const familyName = names[platform]?.fontFamily?.en;
        if (familyName !== undefined && familyName.length > 0) return familyName;
    }
    return undefined;
}

function glyphOutlineOf(glyph: OpenTypeGlyph): GlyphOutline {
    return {
        advance: glyph.advanceWidth ?? 0,
        contours: contoursOf(glyph.path.commands),
    };
}

/**
 * Split a glyph's command list into its contours. `M` starts a contour and `Z`
 * ends one, but the ends need not meet: a font closes a contour implicitly with
 * a straight line, and every contour here gets that line so the kernel sees a
 * closed wire — an open one still extrudes, silently, into a broken solid.
 */
function contoursOf(commands: readonly OpenTypeCommand[]): Contour2D[] {
    const contours: Contour2D[] = [];
    const pen = contourPen(contours);

    for (const command of commands) {
        if (command.type === "M") {
            pen.close();
            pen.start(pointOf(command));
        } else if (command.type === "Z") {
            pen.close();
        } else {
            const segment = segmentOf(command);
            if (segment !== undefined) pen.add(segment, pointOf(command));
        }
    }
    pen.close();

    // A contour with no segments is a font's way of parking a point — it bounds
    // nothing and cannot be nested, so nothing downstream should see it.
    return contours.filter((contour) => contour.segments.length > 0);
}

/**
 * The contour being drawn, as a font states it: `M` lifts the pen and starts another, and a
 * contour is closed where the pen lifts — a font leaves the closing line implicit, and an open
 * contour reaches the kernel as a broken solid rather than as a failure.
 */
function contourPen(contours: Contour2D[]) {
    let current: Contour2D | undefined;
    let cursor: Vec2 = { x: 0, y: 0 };

    const add = (segment: Segment2D, to: Vec2) => {
        if (current === undefined || samePoint(cursor, to)) return;
        current.segments.push(segment);
        cursor = to;
    };

    return {
        add,
        close: () => {
            if (current !== undefined) add({ kind: "line", to: current.start }, current.start);
        },
        start: (at: Vec2) => {
            current = { start: at, segments: [] };
            contours.push(current);
            cursor = at;
        },
    };
}

const pointOf = (command: { x: number; y: number }): Vec2 => ({ x: command.x, y: command.y });

/** The segment a drawing command draws, or none for the two that only move the pen. */
function segmentOf(command: OpenTypeCommand): Segment2D | undefined {
    switch (command.type) {
        case "L":
            return { kind: "line", to: pointOf(command) };
        case "Q":
            return { kind: "quad", c1: { x: command.x1, y: command.y1 }, to: pointOf(command) };
        case "C":
            return {
                kind: "cubic",
                c1: { x: command.x1, y: command.y1 },
                c2: { x: command.x2, y: command.y2 },
                to: pointOf(command),
            };
        default:
            return undefined;
    }
}
