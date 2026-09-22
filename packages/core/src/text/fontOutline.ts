// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A font's outlines: what one is made of, the glyphs a document keeps, and where
 * the outlines come from — the bytes a picker handed over, an address fetched from
 * the web, or what was parsed earlier in this session.
 *
 * All three in one module because they are one subject read in one order: what an
 * outline is, what a text keeps of it, and how a font becomes one. The translation
 * from opentype's commands to this model is in `openTypeOutline`, and the library
 * itself behind `openTypeModule`, so nothing here parses a font command.
 */

import { Result } from "../foundation";
import { loadOpenType, type OpenTypeModule } from "./openTypeModule";
import { familyNameOf, outlineFromOpenType } from "./openTypeOutline";
import type { PickedFont } from "./pickFont";

/**
 * A point in font units, on the glyph's own axes: y grows upward from the
 * baseline, x grows along the writing direction, and one em is `unitsPerEm`
 * units wide. Scaling to millimetres is the only thing a text size does.
 */
export interface Vec2 {
    x: number;
    y: number;
}

/**
 * One piece of a contour, from the previous point to `to`. A font states its
 * outlines as lines and curves, and this keeps them as curves: flattening a
 * quadratic here would put facets on every round letter.
 */
export type Segment2D =
    | { kind: "line"; to: Vec2 }
    | { kind: "quad"; c1: Vec2; to: Vec2 }
    | { kind: "cubic"; c1: Vec2; c2: Vec2; to: Vec2 };

/**
 * A closed loop of the glyph's outline. Every contour is closed — a glyph's
 * contour is implicitly closed even when its last point is not its first, and
 * `closeContour` supplies the missing line.
 */
export interface Contour2D {
    start: Vec2;
    segments: Segment2D[];
}

/** One glyph's outline and how far the pen advances after drawing it. */
export interface GlyphOutline {
    advance: number;
    contours: Contour2D[];
}

/**
 * What the rest of the text feature needs from a font: the glyphs, and how wide
 * the pen moves for a character the font has no glyph for.
 */
export interface FontOutline {
    readonly familyName: string;
    readonly unitsPerEm: number;
    /** Width the pen advances for a character this font does not have. */
    readonly missingAdvance: number;
    glyph(codePoint: number): GlyphOutline | undefined;
}

/** The glyphs a document actually used, in the form a node serializes. */
export interface OutlineCache {
    familyName: string;
    unitsPerEm: number;
    missingAdvance: number;
    /** Keyed by code point as a string, since JSON object keys are strings. */
    glyphs: Record<string, GlyphOutline>;
}

export function cacheOfOutline(font: FontOutline, codePoints: readonly number[]): OutlineCache {
    const glyphs: Record<string, GlyphOutline> = {};
    for (const codePoint of codePoints) {
        const glyph = font.glyph(codePoint);
        if (glyph !== undefined) glyphs[String(codePoint)] = glyph;
    }
    return {
        familyName: font.familyName,
        unitsPerEm: font.unitsPerEm,
        missingAdvance: font.missingAdvance,
        glyphs,
    };
}

export function outlineFromCache(cache: OutlineCache): FontOutline {
    return {
        familyName: cache.familyName,
        unitsPerEm: cache.unitsPerEm,
        missingAdvance: cache.missingAdvance,
        glyph: (codePoint) => cache.glyphs[String(codePoint)],
    };
}

/** Every code point the string uses, in insertion order, without duplicates. */
export function codePointsOf(text: string): number[] {
    const codePoints = new Set<number>();
    for (const character of text) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined) codePoints.add(codePoint);
    }
    return [...codePoints];
}

/**
 * A font is kept by name and address rather than by copying the file into the
 * document: the outlines a node already drew travel with it, so a font only has
 * to be found again when the text is *retyped*.
 *
 * What an outline is remembered by is its address when it has one, else its name.
 * Two fonts with the same name and no address would share an outline — which only
 * happens for two files of the same name picked in one session, and costs the
 * wrong glyphs rather than anything worse.
 */
function keyOf(name: string, url: string): string {
    return url.length > 0 ? url : name;
}

const remembered = new Map<string, FontOutline>();
const pending = new Set<string>();

/** The outline parsed for this font in this session, if any. */
export function cachedOutline(name: string, url: string): FontOutline | undefined {
    return remembered.get(keyOf(name, url));
}

/** Remember outlines for a font, so laying it out again costs nothing. */
export function rememberOutline(name: string, url: string, outline: FontOutline): void {
    remembered.set(keyOf(name, url), outline);
}

/**
 * The outlines of a font the user just picked: the bytes they handed over, or
 * the address to fetch. Picking a font is the one moment its bytes are in hand,
 * which is why this is where a font that has no address gets parsed at all.
 */
export async function outlineOfPicked(picked: PickedFont): Promise<Result<FontOutline>> {
    const url = picked.url ?? "";
    if (picked.data === undefined) return outlineFor(picked.name, url);

    const bytes = decodeDataUrl(picked.data);
    if (bytes === undefined) return Result.err(`"${picked.name}" is not readable`);

    const outline = await parseFont(bytes, picked.name);
    if (outline.isOk) rememberOutline(picked.name, url, outline.value);
    return outline;
}

/**
 * The outlines of a font, from this session's memory or from its address.
 *
 * A font that came off a disk and was parsed in an earlier session cannot be
 * found again — there is no address to fetch it from, and the file is not in the
 * document. That is why the outlines a node drew are kept on the node: this is
 * only ever needed to lay text out *again*.
 */
export async function outlineFor(name: string, url: string): Promise<Result<FontOutline>> {
    const known = cachedOutline(name, url);
    if (known !== undefined) return Result.ok(known);

    if (url.length === 0) {
        return Result.err(`The font "${name}" is not at hand — pick it again to change the text`);
    }

    const key = keyOf(name, url);
    if (pending.has(key)) return Result.err(`The font "${name}" is still being read`);

    pending.add(key);
    try {
        const bytes = await fetchBytes(name, url);
        if (!bytes.isOk) return Result.err(bytes.error);

        const outline = await parseFont(bytes.value, name);
        if (outline.isOk) rememberOutline(name, url, outline.value);
        return outline;
    } finally {
        pending.delete(key);
    }
}

async function fetchBytes(name: string, url: string): Promise<Result<ArrayBuffer>> {
    try {
        const response = await fetch(url);
        return response.ok
            ? Result.ok(await response.arrayBuffer())
            : Result.err(`Could not fetch "${name}": ${response.status}`);
    } catch (error) {
        return Result.err(`Could not fetch "${name}": ${error}`);
    }
}

function decodeDataUrl(dataUrl: string): ArrayBuffer | undefined {
    const separator = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || separator < 0) return undefined;

    const binary = atob(dataUrl.slice(separator + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}

/** How a parser is obtained. A parameter rather than only a module import, so the network can be left out of a test. */
export type OpenTypeLoader = () => Promise<Result<OpenTypeModule>>;

/**
 * Read a font file's bytes as outlines, fetching opentype.js if this is the
 * first time. `name` is what to call the font: a font's own name table is often
 * blank, and the user picked this font by a name they recognise, so theirs wins
 * over whatever the file claims.
 *
 * Malformed bytes are an expected failure — a downloaded file can be anything —
 * and opentype.js reports them by throwing.
 */
export async function parseFont(
    buffer: ArrayBuffer,
    name: string,
    load: OpenTypeLoader = loadOpenType,
): Promise<Result<FontOutline>> {
    const openType = await load();
    if (!openType.isOk) return Result.err(openType.error);

    try {
        const font = openType.value.parse(buffer);
        return Result.ok(outlineFromOpenType(font, familyNameOf(font) ?? name));
    } catch (error) {
        return Result.err(`Failed to read the font: ${error}`);
    }
}
