// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { imageToCanvas } from "@chili3d/element";

/**
 * Waiting for the raster has to end either way: a texture whose image never arrives must not
 * hold a tool call — and the model's turn — open.
 */
const RasterDeadlineMs = 5000;

/**
 * The image a document's texture slot should hold: an SVG source is rasterized to a PNG here,
 * anything else is stored as given.
 *
 * What the document holds is what every later reader renders, and an SVG is rendered at the
 * mercy of the browser that reads it — the same file showed its wood in one corner of every
 * face on a hidpi screen. Converting once, on the way in, is what makes the stored image look
 * the same in every browser and at every pixel ratio.
 */
export async function rasterTextureSource(source: unknown): Promise<unknown> {
    if (typeof source !== "string" || !isSvgSource(source)) return source;

    const canvas = await withDeadline(imageToCanvas(source));
    return canvas === undefined ? source : canvas.toDataURL("image/png");
}

/** The canvas, or undefined when the raster did not arrive in time. */
function withDeadline(work: Promise<HTMLCanvasElement | undefined>): Promise<HTMLCanvasElement | undefined> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), RasterDeadlineMs);
        void work.then((canvas) => {
            clearTimeout(timer);
            resolve(canvas);
        });
    });
}

/**
 * Whether the URL hands the browser an SVG document rather than pixels. Only a source this app
 * can read back cleanly counts: an inline SVG, or an SVG path on this origin. A cross-origin URL
 * would taint the canvas — asking it for the PNG back throws — so it is left to the loader.
 */
function isSvgSource(url: string): boolean {
    if (/^data:image\/svg\+xml/i.test(url)) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;

    return url.split(/[?#]/)[0].toLowerCase().endsWith(".svg");
}
