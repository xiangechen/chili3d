// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger, Result } from "../foundation";
import type { Plane, XYZ } from "../math";
import type { IEdge, IFace, IShape, IWire } from "../shape";
import type { FontOutline } from "./fontOutline";
import { layoutLine } from "./layout";
import { glyphFaces } from "./outlineToShape";
import { pathFrames } from "./pathFrames";
import { pathPlacement, planarPlacement, type TextPlacement } from "./textPlacement";

export interface TextShapeOptions {
    text: string;
    /** Height of one em, in millimetres. */
    size: number;
    /** Where the text sits, and which way it extrudes toward. */
    plane: Plane;
    /** When set, the text follows this edge or wire instead of the plane. */
    path?: IEdge | IWire;
}

export interface TextSolidOptions extends TextShapeOptions {
    /** How far the text is extruded, in millimetres. */
    depth: number;
}

/**
 * A line of text as one shape: every glyph a solid, all of them extruded in one pass
 * and left combined.
 *
 * A font does not state a glyph as a single outline. `田` arrives as four bars that
 * cross and `中` as a box and a bar through it — each a filled region of the
 * even-odd rule, which is how a renderer tells the ink from the gaps. A solid has no
 * such rule, so the regions that overlap have to be fused, and the fusion belongs on
 * the flat regions rather than on the bodies: the same union taken on the bodies has
 * their side walls to sort out too — 402 faces against 42 on a six-character line —
 * and measures 650 ms against 43 ms. Regions that do not overlap are left apart, so
 * text in a Latin font, whose glyphs arrive as one region apiece, pays nothing.
 */
export function textSolid(font: FontOutline, options: TextSolidOptions): Result<IShape> {
    const shape = textShape(font, options);
    if (!shape.isOk) return Result.err(shape.error);

    const fused: IShape[] = [];
    for (const piece of shape.value.pieces) {
        const body = fusedPiece(piece);
        if (!body.isOk) return Result.err(body.error);
        fused.push(body.value);
    }

    const bodies = shapeFactory.combine(fused);
    if (!bodies.isOk) return Result.err(bodies.error);

    return shapeFactory.prism(bodies.value, shape.value.direction.multiply(options.depth));
}

/**
 * The text extruded as far as `depth`, as a preview needs it: the same extrusion, without the
 * fusing a finished body is built with. A preview is a hint at how far the shape reaches, and
 * the fuse costs more than the pointer moving can pay — see `textSolid`.
 */
export function extrudeTextShape(shape: TextShape, depth: number): Result<IShape> {
    return shapeFactory.prism(shape.faces, shape.direction.multiply(depth));
}

/** One solid's worth of a glyph's faces: the regions that overlap, fused into one. */
function fusedPiece(faces: readonly IFace[]): Result<IShape> {
    if (faces.length === 1) return Result.ok(faces[0]);

    const fused = shapeFactory.booleanFuse([faces[0]], faces.slice(1), true);
    if (fused.isOk) return fused;

    // A glyph the kernel will not fuse is still worth drawing: its regions are a
    // valid shape between them, and a seam they leave is better than losing the line
    // over one character.
    Logger.warn(`A text glyph's regions would not fuse: ${fused.error}`);
    return shapeFactory.combine([...faces]);
}

/** The text laid out flat, and the direction it would be extruded along. */
export interface TextShape {
    /** The glyph faces, grouped by the solid each group makes. */
    pieces: IFace[][];
    /** Every piece of the line as one shape, for a caller that draws it flat. */
    faces: IShape;
    /** The direction a solid made from these faces extrudes along. */
    direction: XYZ;
}

/**
 * The text laid out in its plane as one flat shape, before it is extruded: the
 * glyph faces — grouped by the solid each group makes — and the direction they would
 * be extruded along.
 *
 * Extruding is the last thing that happens to a line of text, and the least
 * interesting to look at while it is being placed, so a preview can stop here and
 * draw the outline instead of the solid it would become. It reads `faces`, the whole
 * line combined: a preview draws the regions as they arrive, crossings and all, since
 * fusing them costs more than the pointer moving can pay on every frame.
 */
export function textShape(font: FontOutline, options: TextShapeOptions): Result<TextShape> {
    const layout = layoutLine(font, options.text, options.size);
    if (layout.glyphs.length === 0) return Result.err("There is no text to place");

    if (layout.missing.length > 0) {
        const characters = layout.missing.map((codePoint) => String.fromCodePoint(codePoint)).join("");
        Logger.warn(`The font has no glyph for "${characters}"`);
    }

    const placement = place(options, layout);
    if (!placement.isOk) return Result.err(placement.error);

    const pieces: IFace[][] = [];
    layout.glyphs.forEach((glyph, index) => {
        if (glyph.glyph === undefined) return;
        pieces.push(
            ...glyphFaces(glyph.glyph.contours, {
                toWorld: placement.value.glyphs[index],
                // Anything below this would be a speck of the size it is drawn at.
                minContourSize: options.size * 1e-4,
            }),
        );
    });

    if (pieces.length === 0) return Result.err("The text has no shape to extrude");

    const combined = shapeFactory.combine(pieces.flat());
    return combined.isOk
        ? Result.ok({ pieces, faces: combined.value, direction: placement.value.direction })
        : Result.err(combined.error);
}

function place(options: TextShapeOptions, layout: ReturnType<typeof layoutLine>): Result<TextPlacement> {
    if (options.path === undefined) return Result.ok(planarPlacement(options.plane, layout));

    // The plane still decides which side of the path's plane the text stands on.
    const frames = pathFrames(options.path, options.plane.normal);
    return frames.isOk ? pathPlacement(frames.value, layout) : Result.err(frames.error);
}
