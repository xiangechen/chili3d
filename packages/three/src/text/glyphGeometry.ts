// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Font outlines → triangles for the annotation batch. A glyph is triangulated
 * once and cached at em size (see `annotationFont`); placing a text is then a
 * matter of copying triangles at a scale, never of re-triangulating — the same
 * character-level caching dxf-render and mlightcad use for CAD text.
 */

import type { Contour2D, GlyphOutline, Vec2 } from "@chili3d/core";
import { groupContours } from "@chili3d/core";
import { ShapeUtils, Vector2 } from "three";

/** Subdivisions per Bézier segment when a contour is flattened. */
const CURVE_SEGMENTS = 6;

export interface GlyphGeometry {
    /** Non-indexed triangle corners as flat x,y pairs, in ems (y up from the baseline). */
    readonly triangles: Float32Array;
    /** Pen advance after the glyph, in ems. */
    readonly advance: number;
}

function flattenContour(contour: Contour2D): Vec2[] {
    const points: Vec2[] = [contour.start];
    for (const segment of contour.segments) {
        if (segment.kind === "line") {
            points.push(segment.to);
        } else if (segment.kind === "quad") {
            flattenQuad(points.at(-1)!, segment.c1, segment.to, points);
        } else {
            flattenCubic(points.at(-1)!, segment.c1, segment.c2, segment.to, points);
        }
    }
    return points.filter((point, index) => index === 0 || !samePoint(points[index - 1], point));
}

const samePoint = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

const toVector2 = (point: Vec2) => new Vector2(point.x, point.y);

function flattenQuad(p0: Vec2, c1: Vec2, p1: Vec2, out: Vec2[]) {
    for (let i = 1; i <= CURVE_SEGMENTS; i++) {
        const t = i / CURVE_SEGMENTS;
        const u = 1 - t;
        out.push({
            x: u * u * p0.x + 2 * u * t * c1.x + t * t * p1.x,
            y: u * u * p0.y + 2 * u * t * c1.y + t * t * p1.y,
        });
    }
}

function flattenCubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, out: Vec2[]) {
    for (let i = 1; i <= CURVE_SEGMENTS; i++) {
        const t = i / CURVE_SEGMENTS;
        const u = 1 - t;
        out.push({
            x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
        });
    }
}

/**
 * The triangles of one glyph, normalized to ems. Loops are sorted into filled
 * regions and holes by core's even-odd `groupContours` — the same nesting the
 * shape pipeline draws with — so counters nested several levels deep and fonts
 * that break the winding convention both fill the way the outlines read.
 */
export function triangulateGlyph(glyph: GlyphOutline, unitsPerEm: number): GlyphGeometry {
    const triangles: number[] = [];
    for (const solid of groupContours(glyph.contours)) {
        for (const { outer, holes } of solid) {
            const outerPoints = flattenContour(glyph.contours[outer]).map(toVector2);
            if (outerPoints.length < 3) continue;
            const holePoints = holes
                .map((hole) => flattenContour(glyph.contours[hole]).map(toVector2))
                .filter((hole) => hole.length >= 3);
            // triangulateShape inspects Vector2 identity, not just x/y — hand it real
            // ones — and it pops duplicate end points in place, so the concatenation
            // the face indexes refer to exists only after the call.
            const faces = ShapeUtils.triangulateShape(outerPoints, holePoints);
            const points = [outerPoints, ...holePoints].flat();
            for (const face of faces) {
                for (const index of face) {
                    triangles.push(points[index].x / unitsPerEm, points[index].y / unitsPerEm);
                }
            }
        }
    }
    return { triangles: new Float32Array(triangles), advance: glyph.advance / unitsPerEm };
}

/**
 * Lay `text` out along the baseline: triangles in ems, horizontally centered on
 * the origin and vertically centered on the ink actually drawn — the batch's
 * counterpart of troika's `anchorX/Y = center/middle`. `glyph` answers em-sized
 * geometry; a character it has no glyph for advances `missingAdvance` and draws
 * nothing. Empty ink (a space-only text) comes back as zero-length positions.
 */
export function layoutText(
    text: string,
    glyph: (codePoint: number) => GlyphGeometry | undefined,
    missingAdvance: number,
): { positions: Float32Array } {
    const placed: { geometry: GlyphGeometry; x: number }[] = [];
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
    return { positions };
}
