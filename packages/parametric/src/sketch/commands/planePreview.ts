// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type FaceMeshData, MeshGroup, type Plane, type XYZ } from "@chili3d/core";
import type { DatumPlaneName } from "../planeRef";

/** Side of the datum quad drawn while picking a plane. */
export const DATUM_SIZE = 150;
/**
 * Side of the quad the offset step previews. Larger than the picker's: there it is one of
 * three to tell apart, here it stands for the plane the sketch is about to be drawn on.
 */
export const DATUM_PREVIEW_SIZE = 300;
export const DATUM_GAP = 50;
/** Neutral: the offset preview has nothing to tell apart. */
export const DATUM_COLOR = 0x707070;

/**
 * Quad colours, keyed by plane name. Each takes the hue of the axis its normal runs
 * along — the same red/green/blue the viewport's axes use — so which way a quad faces
 * reads at a glance instead of having to be worked out from the perspective. Softened:
 * these are translucent helpers, not geometry.
 */
export const DATUM_COLORS: Record<DatumPlaneName, number> = {
    YZ: 0xe06c6c, // normal +X
    ZX: 0x6cc46c, // normal +Y
    XY: 0x6c9ce0, // normal +Z
};

/**
 * Opacity of a resting quad, and of a hovered one. Most of the hover cue is this rather
 * than the colour: at 0.25 the hue is diluted by whatever is behind it, so swapping
 * shades alone moves the rendered pixel by only a few levels. Coming up to solid is what
 * makes the change unmistakable.
 */
export const DATUM_OPACITY = 0.25;
export const DATUM_HOVER_OPACITY = 0.7;

/** The same hues, lifted, so a hovered quad brightens as well as solidifies. */
export const DATUM_HIGHLIGHT_COLORS: Record<DatumPlaneName, number> = {
    YZ: 0xff9a9a,
    ZX: 0x9aff9a,
    XY: 0x9ac4ff,
};

/**
 * Double-sided translucent quad in the plane's positive quadrant, with a gap from
 * the axes. Shared by the datum picker and the plane-offset preview so both draw
 * the same shape — the preview then reads as the picked plane moving, not as a
 * different object appearing. `size` is the side length; pass `DATUM_PREVIEW_SIZE`
 * for the preview.
 */
export function datumQuad(plane: Plane, size: number = DATUM_SIZE): FaceMeshData {
    const { origin, xvec, yvec, normal } = plane;
    const corner = (u: number, v: number) => origin.add(xvec.multiply(u)).add(yvec.multiply(v));
    const [min, max] = [DATUM_GAP, DATUM_GAP + size];
    const corners = [corner(min, min), corner(max, min), corner(max, max), corner(min, max)];
    return {
        position: new Float32Array(corners.flatMap((c) => [c.x, c.y, c.z])),
        index: new Uint32Array([0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]),
        normal: new Float32Array(corners.flatMap(() => [normal.x, normal.y, normal.z])),
        uv: new Float32Array(8),
        range: [],
        groups: [new MeshGroup({ start: 0, count: 12, materialIndex: 0 })],
        color: DATUM_COLOR,
    };
}

/**
 * Centre of the quad `datumQuad` draws at the same `size`. A drag handle placed at the
 * plane's origin sits at the quad's corner instead of on it, since the quad is drawn off
 * to one side.
 */
export function datumQuadCenter(plane: Plane, size: number = DATUM_SIZE): XYZ {
    const half = DATUM_GAP + size / 2;
    return plane.origin.add(plane.xvec.multiply(half)).add(plane.yvec.multiply(half));
}
