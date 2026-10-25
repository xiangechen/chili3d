// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { XY, XYZ } from "../math";
import type { IFace, ISurface, ShapeMeshData } from "../shape";
import type { IView } from "./view";

/**
 * The pixel-sized drag arrow value handles draw: the extrude drag and the
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

/**
 * The handle nearest the pointer, within the hover tolerance. Ties go to the FIRST one in
 * the list: handles that share an anchor (a triad's root, a pattern's two directions) must
 * resolve to a stable one, and the first is the one the tool draws first.
 */
export function nearestHandle<Role extends string, Handle extends { readonly role: Role }>(
    handles: readonly Handle[],
    distanceOf: (handle: Handle) => number,
): Role | undefined {
    let nearest: Role | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const handle of handles) {
        const distance = distanceOf(handle);
        if (distance <= ARROW_HOVER_TOLERANCE && distance < best) {
            best = distance;
            nearest = handle.role;
        }
    }
    return nearest;
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

/**
 * `face`'s outward normal at the parameter point nearest `point`, as a UNIT vector — undefined for
 * a face that will not answer either query (a degenerate surface has no direction to offer, and no
 * arrow beats an arrow in the wrong place).
 *
 * Asked at the point the arrow stands on, not at the face's own (0, 0): `planeOfFace` answers with
 * the normal at that parameter, which on a cylinder is its seam and on a sphere is arbitrary — an
 * arrow anchored at the pick and drawn along that sticks out sideways from the pointer.
 *
 * Normalized here rather than by each caller because the kernel hands back the raw `D1U × D1V`
 * (`BRepGProp_Face::Normal`), whose LENGTH follows the surface's parametrization: a cylinder of
 * radius r answers a vector of length r, a sphere r², a plane 1. An arrow is drawn along its
 * direction and its handle travels one unit per unit of value, so a fillet's would outrun the
 * pointer by the radius — which is exactly what a planar face, at length 1, hides.
 */
export function outwardNormalAt(face: IFace, point: XYZ): XYZ | undefined {
    const surface = face.surface();
    // A viewport pick reports the MESH intersection, which sits off the analytic surface by
    // the mesh deflection (0.5% of the bounding box — 0.011 mm measured on an r=10 cylinder),
    // far past the 1e-3 `parameter` tolerance: asked directly, nearly every real pick falls
    // back to the (0, 0) normal — on a cylinder, the seam's. Project first instead; the
    // projected point meets the tolerance, and an already-exact point projects to itself.
    const uv = surface.parameter(point, 1e-3) ?? projectedUV(surface, point);
    const normal = uv === undefined ? face.normal(0, 0)[1] : face.normal(uv.u, uv.v)[1];
    return normal.normalize();
}

/** `point`'s (u, v) read off its projection on `surface`, undefined when it will not project. */
function projectedUV(surface: ISurface, point: XYZ) {
    const nearest = surface.nearestPoint(point);
    return nearest === undefined ? undefined : surface.parameter(nearest[0], 1e-3);
}
