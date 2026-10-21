// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Contour2D,
    type EdgeMeshData,
    type FontOutline,
    flattenContour,
    type GlyphOutline,
    glyphFaces,
    Logger,
    layoutLine,
    type Plane,
    Result,
    type Segment2D,
    usableContours,
    type Vec2,
    XYZ,
} from "@chili3d/core";
import type { SketchEntityData } from "./sketchModel";
import { fusedGlyphContours, fuseGlyphPieces } from "./textFusion";

/**
 * Everything a text entity derives from its sidecar's stored contours: parsing them
 * (memoized — `SketchNode.data` re-parses the document JSON on every read, so object
 * identity cannot key a cache; the contours string itself can), laying new ones out from
 * a font, and the counts, polylines, meshes and distances the model, the node and the
 * editor all read.
 *
 * This module never imports the sketch model at runtime (type-only imports are erased):
 * the model imports `textEdgeCount` from here for `shapeEntityIds`, and a cycle back
 * would be a load-order hazard. That is also why the plane mapping below spells out
 * `sketchModel.toWorld`'s one line rather than importing it.
 */

/** The stored contours of a text entity, or [] when the sidecar is missing or unreadable. */
export function textContoursOf(entity: Pick<SketchEntityData, "text">): Contour2D[] {
    const stored = entity.text?.contours;
    if (stored === undefined) return [];
    return parsedContours(stored);
}

/**
 * The contours of `text` laid out from the baseline origin — anchor-relative sketch
 * millimetres in the UNROTATED local frame (baseline along +x), which is what the sidecar
 * stores; the entity's rotation lives in its own param (`params[2]`) and `textPoint` is
 * where the readers apply it. A glyph's points are in font units and its origin sits at
 * the pen position, so each point scales by `layout.scale` and shifts by the glyph's pen
 * offset along x. What is too small to draw at this size is dropped (`usableContours` —
 * the same filter the text solid applies), so every contour this returns has at least one
 * segment.
 */
export function layoutTextContours(font: FontOutline, text: string, sizeMm: number): Contour2D[] {
    const layout = layoutLine(font, text, sizeMm);
    const contours: Contour2D[] = [];
    for (const placed of layout.glyphs) {
        if (placed.glyph === undefined) continue;
        contours.push(...placedContours(placed.glyph, layout.scale, placed.offset));
    }
    // the identity mapping: the contours are already in the millimetres they are drawn at
    return usableContours(contours, (p) => new XYZ(p.x, p.y, 0), sizeMm * 1e-4);
}

/**
 * The contours of `text` with each glyph's overlapping strokes merged into their union —
 * what a placed text entity stores. A glyph arrives as one closed contour per stroke and
 * the strokes cross (`十`, `国`): kept raw, the crossings would be sketch geometry of their
 * own and the even-odd profile rule would punch the overlap out as holes. The merge is the
 * union `textSolid` takes, taken on the flat regions, once, at layout time — the geometry
 * is rigid afterwards (only the anchor moves), so nothing downstream has to know of it.
 *
 * Async only because both callers are: the kernel work itself is synchronous.
 *
 * Known limit: the union is PER GLYPH. Two adjacent glyphs whose outlines reach into
 * each other — an italic's overhang past its advance — keep their crossing as sketch
 * geometry. The layout applies no kerning, so a glyph that wide is rare; noted, not
 * handled.
 */
export async function fusedTextContours(
    font: FontOutline,
    text: string,
    sizeMm: number,
): Promise<Result<Contour2D[]>> {
    const layout = layoutLine(font, text, sizeMm);
    if (layout.glyphs.length === 0) return Result.err("There is no text to place");
    if (layout.missing.length > 0) {
        const characters = layout.missing.map((codePoint) => String.fromCodePoint(codePoint)).join("");
        Logger.warn(`The font has no glyph for "${characters}"`);
    }

    // the identity mapping: the contours are already in the millimetres they are drawn at
    const toWorld = (p: Vec2): XYZ => new XYZ(p.x, p.y, 0);
    const contours: Contour2D[] = [];
    for (const placed of layout.glyphs) {
        if (placed.glyph === undefined) continue;
        // a glyph whose regions all fail to build contributes nothing (glyphFaces warns) —
        // one malformed glyph must not kill the text
        const pieces = glyphFaces(placedContours(placed.glyph, layout.scale, placed.offset), {
            toWorld,
            minContourSize: sizeMm * 1e-4,
        });
        contours.push(...fusedGlyphContours(fuseGlyphPieces(pieces)));
    }
    return contours.length === 0 ? Result.err("The text has no glyphs to place") : Result.ok(contours);
}

/** One placed glyph's contours in anchor-relative millimetres — the transform both layout paths share. */
function placedContours(glyph: GlyphOutline, scale: number, offset: number): Contour2D[] {
    return glyph.contours.map((contour) => placeContour(contour, scale, offset));
}

/**
 * The stored contours at a new height: a change of size alone. Layout is strictly linear
 * in size (`layoutLine`'s scale, and every pen offset with it), the too-small-to-draw
 * filter's threshold is proportional to it, and the union the contours were merged by
 * commutes with a similarity — so a resize is a multiplication, and asks nothing of the
 * font. This is the ONLY way a text set in a local-file font can be resized at all: such
 * a font is session memory, gone from a reopened document.
 *
 * One-way at the extremes: details the kernel's tolerance collapsed while the text was
 * small stay collapsed when it is scaled up.
 */
export function scaledTextContours(contours: readonly Contour2D[], factor: number): Contour2D[] {
    const scale = (p: Vec2): Vec2 => ({ x: p.x * factor, y: p.y * factor });
    return contours.map((contour) => ({
        start: scale(contour.start),
        segments: contour.segments.map((segment): Segment2D => {
            switch (segment.kind) {
                case "line":
                    return { kind: "line", to: scale(segment.to) };
                case "quad":
                    return { kind: "quad", c1: scale(segment.c1), to: scale(segment.to) };
                default:
                    return {
                        kind: "cubic",
                        c1: scale(segment.c1),
                        c2: scale(segment.c2),
                        to: scale(segment.to),
                    };
            }
        }),
    }));
}

/** One glyph contour scaled to millimetres and shifted to its pen position. */
function placeContour(contour: Contour2D, scale: number, offset: number): Contour2D {
    const place = (p: Vec2): Vec2 => ({ x: p.x * scale + offset, y: p.y * scale });
    return {
        start: place(contour.start),
        segments: contour.segments.map((segment): Segment2D => {
            switch (segment.kind) {
                case "line":
                    return { kind: "line", to: place(segment.to) };
                case "quad":
                    return { kind: "quad", c1: place(segment.c1), to: place(segment.to) };
                default:
                    return {
                        kind: "cubic",
                        c1: place(segment.c1),
                        c2: place(segment.c2),
                        to: place(segment.to),
                    };
            }
        }),
    };
}

/**
 * The entity's edge count: one per segment of every stored contour. The contours are
 * stored filtered (none is empty), so this is exact — and pure data, which is what lets
 * `shapeEntityIds` stay index-for-index with the edges the node builds.
 */
export function textEdgeCount(entity: Pick<SketchEntityData, "text">): number {
    return textContoursOf(entity).reduce((count, contour) => count + contour.segments.length, 0);
}

/**
 * A local-frame contour point in sketch (u, v): rotated by the entity's angle
 * (`params[2]`, the baseline direction — the contours are stored unrotated) about the
 * origin, then translated by the anchor. A stored text always carries the angle; a
 * hand-built one that does not reads as unrotated, which is what the 0 defaults to.
 */
export function textPoint(entity: Pick<SketchEntityData, "params">, u: number, v: number): [number, number] {
    const [anchorU, anchorV, angle = 0] = entity.params;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [anchorU + u * cos - v * sin, anchorV + u * sin + v * cos];
}

/**
 * The stored contours as one polyline each, in sketch (u, v) coordinates: curves
 * flattened (`flattenContour`'s own density), every point turned by the entity's
 * rotation and shifted by its anchor (`textPoint`).
 */
export function sampleTextContours(entity: Pick<SketchEntityData, "text" | "params">): [number, number][][] {
    return textContoursOf(entity).map((contour) =>
        flattenContour(contour).map((p): [number, number] => textPoint(entity, p.x, p.y)),
    );
}

/**
 * All of the entity's contour polylines as one edge mesh: consecutive (p0, p1) segment
 * pairs in one position array, the layout `curveChainMesh` produces and
 * `entityCrossesRect` reads.
 */
export function textContoursMesh(
    plane: Plane,
    entity: Pick<SketchEntityData, "text" | "params">,
    color: number,
    lineType: "solid" | "dash" = "solid",
): EdgeMeshData {
    const polylines = sampleTextContours(entity);
    const segmentCount = polylines.reduce((count, line) => count + Math.max(0, line.length - 1), 0);
    const position = new Float32Array(segmentCount * 6);
    let at = 0;
    for (const line of polylines) {
        for (let i = 1; i < line.length; i++) {
            // sketchModel.toWorld inlined: this module must stay runtime-free of it
            const p0 = plane.origin
                .add(plane.xvec.multiply(line[i - 1][0]))
                .add(plane.yvec.multiply(line[i - 1][1]));
            const p1 = plane.origin.add(plane.xvec.multiply(line[i][0])).add(plane.yvec.multiply(line[i][1]));
            position.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], at);
            at += 6;
        }
    }
    return { position, range: [], color, lineType };
}

/**
 * The probe's distance to the entity's drawn outline: the nearest point of any segment
 * of any contour polyline. A text with nothing stored is nowhere — `Infinity`, so a hit
 * test never lands on it.
 */
export function textEntityDistance(
    uv: [number, number],
    entity: Pick<SketchEntityData, "text" | "params">,
): number {
    let nearest = Infinity;
    for (const line of sampleTextContours(entity)) {
        for (let i = 1; i < line.length; i++) {
            nearest = Math.min(nearest, segmentDistance(uv, line[i - 1], line[i]));
        }
    }
    return nearest;
}

/** The probe's distance to one polyline segment. */
function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t =
        lengthSquared < 1e-12
            ? 0
            : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// ------------------------------------------------------------------ Stored-contour parsing

/** Bound on the parse memo: a document's texts share strings across reads, but a pathological session must not grow it without end. */
const PARSED_CONTOURS_CAP = 64;

const parsedContoursMemo = new Map<string, Contour2D[]>();

/**
 * The contours a stored string parses to, memoized by the string itself. An unreadable
 * string — or one that parses to something that is not well-formed contours — is []: a
 * hand-edited or corrupted sidecar leaves the entity with no outline rather than
 * crashing its readers.
 */
function parsedContours(stored: string): Contour2D[] {
    const memo = parsedContoursMemo.get(stored);
    if (memo !== undefined) return memo;

    let parsed: unknown;
    try {
        parsed = JSON.parse(stored);
    } catch {
        parsed = undefined;
    }
    const contours = Array.isArray(parsed) && parsed.every(isContour2D) ? parsed : [];
    if (parsedContoursMemo.size >= PARSED_CONTOURS_CAP) {
        const oldest = parsedContoursMemo.keys().next().value;
        if (oldest !== undefined) parsedContoursMemo.delete(oldest);
    }
    parsedContoursMemo.set(stored, contours);
    return contours;
}

function isVec2(value: unknown): value is Vec2 {
    const point = value as Vec2;
    return (
        typeof point === "object" &&
        point !== null &&
        typeof point.x === "number" &&
        typeof point.y === "number"
    );
}

function isSegment2D(value: unknown): value is Segment2D {
    const segment = value as Segment2D;
    if (typeof segment !== "object" || segment === null || !isVec2(segment.to)) return false;
    switch (segment.kind) {
        case "line":
            return true;
        case "quad":
            return isVec2((segment as { c1?: unknown }).c1);
        case "cubic":
            return isVec2((segment as { c1?: unknown }).c1) && isVec2((segment as { c2?: unknown }).c2);
        default:
            return false;
    }
}

function isContour2D(value: unknown): value is Contour2D {
    const contour = value as Contour2D;
    return (
        typeof contour === "object" &&
        contour !== null &&
        isVec2(contour.start) &&
        Array.isArray(contour.segments) &&
        contour.segments.every(isSegment2D)
    );
}
