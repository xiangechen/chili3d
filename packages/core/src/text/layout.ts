// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FontOutline, GlyphOutline } from "./fontOutline";

/** One character placed on the line, with the pen position of its origin. */
export interface PlacedGlyph {
    codePoint: number;
    /** Undefined when the font has no glyph for this character; the pen still advances. */
    glyph: GlyphOutline | undefined;
    /** Distance from the line's start to this glyph's origin, in millimetres. */
    offset: number;
    /** How far the pen moves after this glyph, in millimetres. */
    advance: number;
}

export interface TextLayout {
    /** Font units to millimetres, for scaling the glyph outlines. */
    scale: number;
    /** Total pen advance, in millimetres. */
    width: number;
    glyphs: PlacedGlyph[];
    /** Characters the font had no glyph for, in the order they appear. */
    missing: number[];
}

/**
 * Lay a single line of text out from the origin, in millimetres.
 *
 * The pen advances by each glyph's own advance, and by the font's `.notdef`
 * advance for characters it has no glyph for — a character a font lacks still
 * occupies the space that font reserves for it, so the rest of the line does not
 * slide over.
 *
 * Iterating the string yields code points, not UTF-16 units: a half of a
 * surrogate pair is not a character and would ask the font for a glyph that
 * cannot exist.
 */
export function layoutLine(font: FontOutline, text: string, size: number): TextLayout {
    const scale = size / font.unitsPerEm;
    const glyphs: PlacedGlyph[] = [];
    const missing: number[] = [];
    let pen = 0;

    for (const character of text) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) continue;

        const glyph = font.glyph(codePoint);
        if (glyph === undefined) missing.push(codePoint);
        const advance = (glyph?.advance ?? font.missingAdvance) * scale;

        glyphs.push({ codePoint, glyph, offset: pen, advance });
        pen += advance;
    }

    return { scale, width: pen, glyphs, missing };
}
