// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * 3D layout for dimension annotations. Sizes derive from a scale factor — the
 * callers pass `DIMENSION_LAYOUT_SCALE`, so text, arrows and gaps keep a fixed
 * world size (mm) like dimensions on a drafting sheet — the 3D counterpart of
 * the sketch editor's uv-space `dimensionLayout`.
 */

import { MathUtils, XYZ } from "../math";
import type { DimensionType } from "./annotation";

export interface DimensionLayout {
    /** Flat xyz pairs: two extension lines, the dimension line / leader / arc polyline. */
    readonly segments: number[];
    /** Flat xyz triples: the solid arrowheads, three corners per triangle. */
    readonly triangles: number[];
    /** Anchor point for the dimension text. */
    readonly textPosition: XYZ;
    /** Normal of the plane the dimension is drawn in. */
    readonly normal: XYZ;
    /** Unit vector along the measured segment, start → end. */
    readonly direction: XYZ;
    /** In-plane perpendicular of `direction`, pointing toward the text side. */
    readonly side: XYZ;
}

// Shared with the sketch editor's 2D dimension layout (@chili3d/parametric,
// sketch/editor/dimensionLayout) — change them together.
export const DIMENSION_ARROW_LENGTH_PX = 10;
export const DIMENSION_ARROW_HALF_ANGLE = (20 * Math.PI) / 180;
export const DIMENSION_EXTENSION_GAP_PX = 3;
export const DIMENSION_EXTENSION_OVERSHOOT_PX = 4;
export const DIMENSION_MIN_OFFSET_PX = 14;
const TEXT_HEIGHT_PX = 12;

/**
 * Dimension text height in world units (mm), ISO/GB drafting-style: the whole
 * annotation keeps this absolute size, so it grows and shrinks with the model
 * when zooming. The px-based layout constants scale around it through
 * `DIMENSION_LAYOUT_SCALE`, which the command preview and the viewport visual
 * both use so they draw identical geometry. (The viewport's text pipeline lays
 * glyphs at one em per text height, matching `TEXT_HEIGHT_PX`.)
 */
export const DIMENSION_TEXT_HEIGHT = 3.5;
export const DIMENSION_LAYOUT_SCALE = DIMENSION_TEXT_HEIGHT / TEXT_HEIGHT_PX;

/**
 * The layout scale that gives a text height of `textHeight` world units — the
 * per-annotation counterpart of `DIMENSION_LAYOUT_SCALE`, so arrows and gaps
 * grow in proportion with the text.
 */
export function dimensionLayoutScale(textHeight: number): number {
    return textHeight / TEXT_HEIGHT_PX;
}

function segment(p: XYZ, q: XYZ): number[] {
    return [p.x, p.y, p.z, q.x, q.y, q.z];
}

/**
 * A solid triangle: `tip` on the measured geometry, the base corners one arrow
 * length back along `outward` — the silhouette of the drafting open arrowhead,
 * filled. `outward` is the direction the arrow points to.
 */
function arrowhead(tip: XYZ, outward: XYZ, normal: XYZ, scale: number): number[] {
    const length = DIMENSION_ARROW_LENGTH_PX * scale;
    const cos = Math.cos(DIMENSION_ARROW_HALF_ANGLE);
    const sin = Math.sin(DIMENSION_ARROW_HALF_ANGLE);
    const back = outward.multiply(-1);
    const perp = normal.cross(back).normalize()!;
    const corner = (s: number) =>
        tip.add(
            back
                .multiply(cos)
                .add(perp.multiply(sin * s))
                .multiply(length),
        );
    const a = corner(1);
    const b = corner(-1);
    return [tip.x, tip.y, tip.z, a.x, a.y, a.z, b.x, b.y, b.z];
}

/**
 * The plane the dimension is drawn in: the measured direction and the text point
 * fix it. A text point on the measured line leaves the plane free — any plane
 * containing the line will do.
 */
function dimensionPlane(dir: XYZ, start: XYZ, textPoint: XYZ): { normal: XYZ; side: XYZ } {
    let normal = dir.cross(textPoint.sub(start)).normalize();
    if (normal === undefined) {
        const seed = Math.abs(dir.z) < 0.9 ? XYZ.unitZ : XYZ.unitX;
        normal = dir.cross(seed).normalize()!;
    }
    // `side` lies in the dimension plane, perpendicular to the measured direction
    return { normal, side: normal.cross(dir).normalize()! };
}

export interface DimensionOffsets {
    /** Side of the measured geometry the dimension sits on. */
    readonly sign: number;
    /** Signed distance from the geometry to the dimension line (clamped away from it). */
    readonly off: number;
    /** Signed gap between the geometry and the extension line start. */
    readonly gap: number;
    /** Signed distance from the geometry to the extension line end. */
    readonly overshoot: number;
}

/**
 * Where the dimension line sits relative to the measured geometry: `off` is the
 * signed distance to it (clamped away from the geometry), `gap` and `overshoot`
 * follow its side so the extension line never crosses the geometry. Pure math so
 * the sketch editor's 2D layout shares it — change both sides together.
 */
export function dimensionOffsets(offset: number, scale: number): DimensionOffsets {
    const sign = offset >= 0 ? 1 : -1;
    const off = sign * Math.max(Math.abs(offset), DIMENSION_MIN_OFFSET_PX * scale);
    return {
        sign,
        off,
        gap: sign * DIMENSION_EXTENSION_GAP_PX * scale,
        overshoot: off + sign * DIMENSION_EXTENSION_OVERSHOOT_PX * scale,
    };
}

/**
 * The fallback annotation plane when the cursor has said nothing yet: the plane
 * closest to containing `dir` wins — the axis most perpendicular to it,
 * orthogonalized against it; ties go to the axis most facing the view, like the
 * dynamic workplane (`ViewUtils.raycastClosestPlane`). With a pick in hand the
 * command infers the plane from the on-screen drag instead (world-space offsets
 * of the picked point are dominated by the camera, not the drag).
 */
export function nearestDimensionNormal(dir: XYZ, viewDirection: XYZ): XYZ {
    let best = XYZ.unitZ;
    let bestOff = Number.MAX_VALUE;
    let bestFacing = -1;
    for (const axis of [XYZ.unitX, XYZ.unitY, XYZ.unitZ]) {
        const off = Math.abs(axis.dot(dir));
        const facing = Math.abs(axis.dot(viewDirection));
        if (
            (off < bestOff && !MathUtils.almostEqual(off, bestOff)) ||
            (MathUtils.almostEqual(off, bestOff) && facing > bestFacing)
        ) {
            best = axis;
            bestOff = off;
            bestFacing = facing;
        }
    }
    return best.sub(dir.multiply(best.dot(dir))).normalize()!;
}

// Shared with the sketch editor's 2D dimension layout — change them together.
export const DIMENSION_RADIAL_LABEL_MARGIN_PX = 20;
export const DIMENSION_MIN_ANGLE_RADIUS_PX = 24;
export const DIMENSION_ANGLE_LABEL_MARGIN_PX = 14;

/**
 * The plane frame of a radial/diameter dimension: the stored circle axis when
 * there is one — the leader direction and the text point are collinear by
 * construction, so no plane can be derived from the points themselves. Without
 * it (legacy documents) the text-point derivation still applies.
 */
function radialFrame(dir: XYZ, center: XYZ, textPoint: XYZ, planeNormal?: XYZ): { normal: XYZ; side: XYZ } {
    if (planeNormal !== undefined) {
        const normal = planeNormal.normalize()!;
        const side = normal.cross(dir).normalize();
        if (side !== undefined) return { normal, side };
        // the leader left the circle plane entirely (an off-plane grip drag)
    }
    return dimensionPlane(dir, center, textPoint);
}

/**
 * Radial dimension of a circle/arc: a leader from `center` through `rim` to the
 * label, arrow on the rim pointing outward. `textPoint` picks the leader's
 * direction (through `rim`) and the label distance; a pick inside the circle
 * pushes the label out past the rim, like the 2D sketch editor does.
 * `planeNormal` is the circle's axis, keeping the arrows in the circle plane.
 */
export function radialDimensionLayout(
    center: XYZ,
    rim: XYZ,
    textPoint: XYZ,
    scale: number,
    planeNormal?: XYZ,
): DimensionLayout | undefined {
    const dir = rim.sub(center).normalize();
    if (dir === undefined || scale <= 0) return undefined;

    const { normal, side } = radialFrame(dir, center, textPoint, planeNormal);
    const radius = center.distanceTo(rim);
    const labelDistance = Math.max(
        center.distanceTo(textPoint),
        radius + DIMENSION_RADIAL_LABEL_MARGIN_PX * scale,
    );
    const label = center.add(dir.multiply(labelDistance));

    const segments = segment(center, label);
    const triangles = arrowhead(rim, dir, normal, scale);
    const textPosition = label.add(side.multiply(TEXT_HEIGHT_PX * scale * 0.5));
    return { segments, triangles, textPosition, normal, direction: dir, side };
}

/**
 * Diameter dimension of a circle: the dimension line crosses the center from one
 * rim point to the other, arrows pointing outward at both. `rim1`/`rim2` are the
 * picked rim points; `textPoint` picks the side the label extends to and its
 * distance along the line (a close pick is pushed out past the rim).
 */
export function diameterDimensionLayout(
    rim1: XYZ,
    rim2: XYZ,
    textPoint: XYZ,
    scale: number,
    planeNormal?: XYZ,
): DimensionLayout | undefined {
    let dir = rim2.sub(rim1).normalize();
    if (dir === undefined || scale <= 0) return undefined;

    const center = rim1.add(rim2).multiply(0.5);
    if (textPoint.sub(center).dot(dir) < 0) dir = dir.reverse();
    const { normal, side } = radialFrame(dir, center, textPoint, planeNormal);
    const radius = center.distanceTo(rim1);
    const labelDistance = Math.max(
        textPoint.sub(center).dot(dir),
        radius + DIMENSION_RADIAL_LABEL_MARGIN_PX * scale,
    );

    const label = center.add(dir.multiply(labelDistance));
    const rimFar = center.add(dir.multiply(-radius));
    const rimNear = center.add(dir.multiply(radius));
    const segments = segment(rimFar, label);
    const triangles = [
        ...arrowhead(rimFar, dir.reverse(), normal, scale),
        ...arrowhead(rimNear, dir, normal, scale),
    ];
    const textPosition = label.add(side.multiply(TEXT_HEIGHT_PX * scale * 0.5));
    return { segments, triangles, textPosition, normal, direction: dir, side };
}

/** The orthonormal frame an angle dimension lives in: u along d1, normal = u×d2. */
interface AngleFrame {
    readonly u: XYZ;
    readonly v: XYZ;
    readonly normal: XYZ;
    /** The smaller angle from d1 to d2, in (0, π). */
    readonly theta2: number;
}

function angleFrame(vertex: XYZ, p1: XYZ, p2: XYZ): AngleFrame | undefined {
    const u = p1.sub(vertex).normalize();
    const d2 = p2.sub(vertex).normalize();
    if (u === undefined || d2 === undefined) return undefined;
    const normal = u.cross(d2).normalize();
    if (normal === undefined) return undefined;
    const v = normal.cross(u);
    return { u, v, normal, theta2: Math.atan2(d2.dot(v), d2.dot(u)) };
}

/** The sweep the text point picks: the smaller angle while it points inside it, else the reflex. */
function sweepInFrame(frame: AngleFrame, vertex: XYZ, textPoint: XYZ): number {
    const t = textPoint.sub(vertex);
    const tDir = t.sub(frame.normal.multiply(t.dot(frame.normal))).normalize();
    // A text point on the axis says nothing: take the smaller sweep.
    const at = tDir === undefined ? frame.theta2 / 2 : Math.atan2(tDir.dot(frame.v), tDir.dot(frame.u));
    return at >= 0 && at <= frame.theta2 ? frame.theta2 : frame.theta2 - Math.PI * 2;
}

/**
 * The signed sweep an angular dimension draws, in radians in (−2π, 2π): d1→d2
 * the short way while `textPoint` sits inside that sweep, the reflex otherwise.
 * Shared by the layout and `DimensionAnnotation.value` so the drawing and the
 * displayed number never disagree.
 */
export function angularDimensionSweep(vertex: XYZ, p1: XYZ, p2: XYZ, textPoint: XYZ): number | undefined {
    const frame = angleFrame(vertex, p1, p2);
    return frame === undefined ? undefined : sweepInFrame(frame, vertex, textPoint);
}

/**
 * Angular dimension between two directions around `vertex` (`p1`/`p2` carry the
 * directions): an arc swept from d1 to d2 through the side `textPoint` sits on,
 * arrows tangent at both ends, text on the bisector past the arc.
 */
export function angularDimensionLayout(
    vertex: XYZ,
    p1: XYZ,
    p2: XYZ,
    textPoint: XYZ,
    scale: number,
): DimensionLayout | undefined {
    const frame = angleFrame(vertex, p1, p2);
    if (frame === undefined || scale <= 0) return undefined;
    const { u, v, normal } = frame;
    const sweep = sweepInFrame(frame, vertex, textPoint);

    const radius = Math.max(vertex.distanceTo(textPoint), DIMENSION_MIN_ANGLE_RADIUS_PX * scale);
    const arcPoint = (angle: number) =>
        vertex.add(u.multiply(radius * Math.cos(angle))).add(v.multiply(radius * Math.sin(angle)));

    const segments: number[] = [];
    const count = Math.max(4, Math.ceil((Math.abs(sweep) / Math.PI) * 16));
    for (let i = 0; i < count; i++) {
        segments.push(...segment(arcPoint((sweep * i) / count), arcPoint((sweep * (i + 1)) / count)));
    }
    // Tangent at an arc end, pointing along the sweep.
    const tangent = (angle: number, forward: boolean): XYZ => {
        const s = (forward ? 1 : -1) * Math.sign(sweep);
        return u.multiply(-Math.sin(angle) * s).add(v.multiply(Math.cos(angle) * s));
    };
    const triangles = [
        ...arrowhead(arcPoint(0), tangent(0, false), normal, scale),
        ...arrowhead(arcPoint(sweep), tangent(sweep, true), normal, scale),
    ];

    const mid = sweep / 2;
    const bisector = u.multiply(Math.cos(mid)).add(v.multiply(Math.sin(mid)));
    const textPosition = vertex.add(bisector.multiply(radius + DIMENSION_ANGLE_LABEL_MARGIN_PX * scale));
    // The text stands on the arc: baseline along the clockwise tangent at its
    // midpoint, up along the bisector — direction × side = normal, the same
    // right-handed text frame the linear layout returns.
    const direction = u.multiply(Math.sin(mid)).sub(v.multiply(Math.cos(mid)));
    return { segments, triangles, textPosition, normal, direction, side: bisector };
}

/**
 * Aligned distance dimension between `start` and `end`. `textPoint` fixes the
 * plane (together with the measured direction), the offset side, and the text's
 * position along the dimension line.
 */
export function linearDimensionLayout(
    start: XYZ,
    end: XYZ,
    textPoint: XYZ,
    scale: number,
): DimensionLayout | undefined {
    const length = start.distanceTo(end);
    const dir = end.sub(start).normalize();
    if (dir === undefined || scale <= 0) return undefined;

    const { normal, side } = dimensionPlane(dir, start, textPoint);
    const rawOffset = textPoint.sub(start).dot(side);
    const { sign, off, gap, overshoot } = dimensionOffsets(rawOffset, scale);

    const shift = (p: XYZ, d: number) => p.add(side.multiply(d));
    const a = shift(start, off);
    const b = shift(end, off);

    const segments = [
        ...segment(shift(start, gap), shift(start, overshoot)),
        ...segment(shift(end, gap), shift(end, overshoot)),
        ...segment(a, b),
    ];
    // CAD convention: arrow tips touch the extension lines, pointing outward
    const triangles = [...arrowhead(a, dir.multiply(-1), normal, scale), ...arrowhead(b, dir, normal, scale)];

    const along = Math.min(Math.max(textPoint.sub(a).dot(dir), 0), length);
    const textPosition = a.add(dir.multiply(along)).add(side.multiply(sign * TEXT_HEIGHT_PX * scale * 0.5));
    return { segments, triangles, textPosition, normal, direction: dir, side };
}

/**
 * The layout for one dimension kind — the single dispatch both the viewport
 * visual and the drag plane go through, so they always agree on the geometry.
 * `center` is the angle vertex, only an angular dimension carries one;
 * `planeNormal` is the circle axis, only radial/diameter dimensions carry one.
 */
export function dimensionLayoutFor(
    type: DimensionType,
    start: XYZ,
    end: XYZ,
    textPoint: XYZ,
    scale: number,
    center?: XYZ,
    planeNormal?: XYZ,
): DimensionLayout | undefined {
    switch (type) {
        case "radial":
            return radialDimensionLayout(start, end, textPoint, scale, planeNormal);
        case "diameter":
            return diameterDimensionLayout(start, end, textPoint, scale, planeNormal);
        case "angular":
            return center === undefined
                ? undefined
                : angularDimensionLayout(center, start, end, textPoint, scale);
        default:
            return linearDimensionLayout(start, end, textPoint, scale);
    }
}
