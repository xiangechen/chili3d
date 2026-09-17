// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IView, ShapeMeshData, XY, XYZ } from "@chili3d/core";

/**
 * The pixel-sized drag arrow both value handles draw: the extrude drag and the
 * fillet/chamfer drag show the same handle, so its constants and its pure geometry
 * live here instead of in either step. What each handler does with the arrow — when to
 * show it, hover and drag state, camera tracking — stays in the handler.
 */

/** Blue handle color, distinct from the green highlight/selection tints. */
export const ARROW_COLOR = 0x3b82f6;

/** Lighter blue shown while the pointer hovers the arrow. */
export const ARROW_HOVER_COLOR = 0x93c5fd;

/** Canonical arrow length (mm); geometry is meshed at this size and scaled on display. */
export const ARROW_LENGTH = 40;

/** Target on-screen arrow length (px); the world length adapts so zooming never resizes the arrow. */
const ARROW_LENGTH_PX = 80;

export const ARROW_HOVER_TOLERANCE = 10; // px, screen-space distance to the arrow shaft

/** Baseline (world units) for the px/mm measurement; long enough to beat worldToScreen rounding. */
const SCALE_MEASURE_BASELINE = 100;

/** Solid cylinder shaft + cone head, starting at `start` and pointing along `direction`. */
export function arrowMeshes(start: XYZ, direction: XYZ, length: number, color: number): ShapeMeshData[] {
    const headLength = Math.max(length * 0.45, 8);
    const shaftLength = length - headLength;
    return [
        shapeFactory.cylinder(direction, start, headLength * 0.1, shaftLength),
        shapeFactory.cone(
            direction,
            start.add(direction.multiply(shaftLength)),
            headLength * 0.3,
            0,
            headLength,
        ),
    ].map((shape) => {
        if (!shape.isOk) throw shape.error;
        const mesh = shape.value.mesh.faces!;
        mesh.color = color;
        shape.value.dispose();
        return mesh;
    });
}

/** Screen-space distance from point (`x`, `y`) to the segment `a`–`b`. */
export function distanceToSegment(x: number, y: number, a: XY, b: XY): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lengthSq));
    return Math.hypot(x - a.x - t * abx, y - a.y - t * aby);
}

/**
 * The world length at which an arrow anchored at `anchor` along `axis` renders at
 * ARROW_LENGTH_PX, or undefined when the view degenerates at that anchor.
 */
export function pxSizedArrowLength(view: IView, anchor: XYZ, axis: XYZ): number | undefined {
    // A screen-parallel unit vector: perpendicular to both the view and the arrow
    // direction, falling back to the view's up when the arrow points at the camera.
    const side = view.direction().cross(axis).normalize() ?? view.up();
    const a = view.worldToScreen(anchor);
    const b = view.worldToScreen(anchor.add(side.multiply(SCALE_MEASURE_BASELINE)));
    const pxPerUnit = a.distanceTo(b) / SCALE_MEASURE_BASELINE;
    return pxPerUnit > 1e-6 ? ARROW_LENGTH_PX / pxPerUnit : undefined;
}
