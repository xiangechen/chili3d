// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Font outlines → triangles, for callers that draw text as mesh rather than as a
 * shape (dimension annotations, 3D annotation batches). A glyph is triangulated
 * once and cached per font (see `glyphTrianglesOf`); placing a text is then a
 * matter of copying triangles at a scale, never of re-triangulating — the same
 * character-level caching dxf-render and mlightcad use for CAD text.
 *
 * This is the flat counterpart of `outlineToShape`'s B-rep faces: the same
 * contours, the same `groupContours` nesting, only the last step differs — ear
 * clipping (`triangulatePolygon`) instead of kernel faces.
 */

import { type Polygon, triangulatePolygon } from "../math";
import { flattenContour, groupContours } from "./contourRegions";
import type { Contour2D, FontOutline, GlyphOutline } from "./fontOutline";

/** Curve subdivisions when a contour is flattened for triangulation. */
const CURVE_STEPS = 6;

export interface GlyphTriangles {
    /** Non-indexed triangle corners as flat x,y pairs, in ems (y up from the baseline). */
    readonly triangles: Float32Array;
    /** Pen advance after the glyph, in ems. */
    readonly advance: number;
}

/**
 * The triangles of one glyph, normalized to ems. Loops are sorted into filled
 * regions and holes by the even-odd `groupContours` — the same nesting the shape
 * pipeline draws with — so counters nested several levels deep and fonts that
 * break the winding convention both fill the way the outlines read.
 */
export function triangulateGlyph(glyph: GlyphOutline, unitsPerEm: number): GlyphTriangles {
    const triangles: number[] = [];
    for (const solid of groupContours(glyph.contours)) {
        for (const { outer, holes } of solid) {
            const outerPolygon = contourPolygon(glyph.contours[outer]);
            if (outerPolygon.length < 3) continue;
            const holePolygons = holes
                .map((hole) => contourPolygon(glyph.contours[hole]))
                .filter((hole) => hole.length >= 3);
            for (const [x, y] of triangulatePolygon(outerPolygon, holePolygons)) {
                triangles.push(x / unitsPerEm, y / unitsPerEm);
            }
        }
    }
    return { triangles: new Float32Array(triangles), advance: glyph.advance / unitsPerEm };
}

function contourPolygon(contour: Contour2D): Polygon {
    return flattenContour(contour, CURVE_STEPS).map((point): [number, number] => [point.x, point.y]);
}

const glyphCaches = new WeakMap<FontOutline, Map<number, GlyphTriangles | undefined>>();

/** A glyph's triangles, triangulated on first ask per font; undefined when the font lacks it. */
export function glyphTrianglesOf(font: FontOutline, codePoint: number): GlyphTriangles | undefined {
    let cache = glyphCaches.get(font);
    if (cache === undefined) {
        cache = new Map();
        glyphCaches.set(font, cache);
    }
    if (!cache.has(codePoint)) {
        const glyph = font.glyph(codePoint);
        cache.set(codePoint, glyph === undefined ? undefined : triangulateGlyph(glyph, font.unitsPerEm));
    }
    return cache.get(codePoint);
}

/**
 * Lay `text` out along the baseline: triangles in ems, horizontally centered on
 * the origin and vertically centered on the ink actually drawn — the counterpart
 * of troika's `anchorX/Y = center/middle`. `glyph` answers em-sized geometry; a
 * character it has no glyph for advances `missingAdvance` and draws nothing.
 * Empty ink (a space-only text) comes back as zero-length positions.
 */
export function layoutGlyphTriangles(
    text: string,
    glyph: (codePoint: number) => GlyphTriangles | undefined,
    missingAdvance: number,
): Float32Array {
    const placed: { geometry: GlyphTriangles; x: number }[] = [];
    let cursor = 0;
    for (const character of text) {
        const codePoint = character.codePointAt(0)!;
        const geometry = glyph(codePoint);
        if (geometry !== undefined && geometry.triangles.length > 0) {
            placed.push({ geometry, x: cursor });
        }
        cursor += geometry?.advance ?? missingAdvance;
    }

    let minY = Infinity;
    let maxY = -Infinity;
    for (const { geometry } of placed) {
        for (let i = 1; i < geometry.triangles.length; i += 2) {
            minY = Math.min(minY, geometry.triangles[i]);
            maxY = Math.max(maxY, geometry.triangles[i]);
        }
    }

    const positions = new Float32Array(
        placed.reduce((sum, { geometry }) => sum + geometry.triangles.length, 0),
    );
    const offsetX = -cursor / 2;
    const offsetY = placed.length === 0 ? 0 : -(minY + maxY) / 2;
    let write = 0;
    for (const { geometry, x } of placed) {
        for (let i = 0; i < geometry.triangles.length; i += 2) {
            positions[write++] = x + offsetX + geometry.triangles[i];
            positions[write++] = offsetY + geometry.triangles[i + 1];
        }
    }
    return positions;
}

/** `layoutGlyphTriangles` over a font, with its own glyph cache and missing advance. */
export function layoutTextTriangles(font: FontOutline, text: string): Float32Array {
    return layoutGlyphTriangles(
        text,
        (codePoint) => glyphTrianglesOf(font, codePoint),
        font.missingAdvance / font.unitsPerEm,
    );
}
