// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger, Result } from "../foundation";
import type { Plane, XYZ } from "../math";
import type { TextLayout } from "./layout";
import type { ToWorld } from "./outlineToShape";
import type { PathFrames } from "./pathFrames";

/**
 * Where a laid-out line of text goes: one mapping per glyph, and the direction
 * the whole line extrudes along. Glyphs are placed rigidly — rotated to face the
 * direction they are drawn in, never stretched — so a letter keeps its shape
 * whichever way it is turned.
 */
export interface TextPlacement {
    glyphs: ToWorld[];
    direction: XYZ;
}

/**
 * Lay the text along the plane's own axes, its baseline starting at the plane's
 * origin. Glyphs sit in font units scaled to millimetres, so the text is exactly
 * as tall as its size.
 */
export function planarPlacement(plane: Plane, layout: TextLayout): TextPlacement {
    return {
        direction: plane.normal,
        glyphs: layout.glyphs.map(
            (glyph) => (point) =>
                plane.origin
                    .add(plane.xvec.multiply(glyph.offset + point.x * layout.scale))
                    .add(plane.yvec.multiply(point.y * layout.scale)),
        ),
    };
}

/**
 * Lay the text along a path, centred on it. The line is placed by its baseline:
 * the path is where the feet of the letters sit.
 *
 * Text wider than the path is refused rather than squeezed — shrinking letters
 * to fit would silently change the size the user asked for.
 */
export function pathPlacement(frames: PathFrames, layout: TextLayout): Result<TextPlacement> {
    if (layout.width > frames.length) {
        // More text than path is not a failure: the part that does not fit reads on past the
        // end, where it is plain to see — and putting nothing at all on screen would be a
        // worse way to say it.
        Logger.warn(
            `The text is ${layout.width.toFixed(2)} long on a path of ${frames.length.toFixed(2)}: it runs on past the end`,
        );
    }

    // Centred where there is room to centre, and begun at the path's own start where there is
    // not: an overflowing line is read from its first letter.
    const start = Math.max(0, (frames.length - layout.width) / 2);
    const glyphs: ToWorld[] = [];

    for (const glyph of layout.glyphs) {
        const frame = frames.at(start + glyph.offset);
        if (frame === undefined) return Result.err("The path has no direction where the text would sit");

        glyphs.push((point) =>
            frame.point
                .add(frame.tangent.multiply(point.x * layout.scale))
                .add(frame.up.multiply(point.y * layout.scale)),
        );
    }

    return Result.ok({ glyphs, direction: frames.normal });
}
