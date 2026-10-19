// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * 3D layout for dimension annotations: the planar layout (`planarDimensionLayout`) laid
 * out on the measured geometry's own frame and lifted back into space. Sizes derive from
 * a scale factor — the callers pass `DIMENSION_LAYOUT_SCALE`, so text, arrows and gaps
 * keep a fixed world size (mm) like dimensions on a drafting sheet.
 */

import { MathUtils, XYZ } from "../math";
import type { DimensionType } from "./annotation";
import type { AngleTextPlacement, LinearTextPlacement, ResolvedLine } from "./annotationAssociation";
import {
    angleDimension,
    DIMENSION_ANGLE_LABEL_MARGIN_PX,
    DIMENSION_ARROW_HALF_ANGLE,
    DIMENSION_ARROW_LENGTH_PX,
    DIMENSION_BASE_TEXT_HEIGHT_PX,
    DIMENSION_MIN_ANGLE_RADIUS_PX,
    DIMENSION_RADIAL_LABEL_MARGIN_PX,
    type DimensionGeometry,
    type DimensionSize,
    distanceDimension,
    type Point2,
    radiusDimension,
} from "./planarDimensionLayout";

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

const TEXT_HEIGHT_PX = DIMENSION_BASE_TEXT_HEIGHT_PX;

/** sine² threshold for an angular dimension's two lines — below ~0.08° there is no vertex. */
const MIN_ANGLE_SINE = 1e-6;

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
 * pushes the label out past the rim, as it does in the sketch editor — both draw the
 * planar `radiusDimension` laid out in the leader's own frame.
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
    // The frame runs down the leader: the label vector is the picked distance along it,
    // and the planar layout applies the rim margin.
    const geometry = radiusDimension(
        [0, 0],
        radius,
        [center.distanceTo(textPoint), 0],
        annotationSize(scale),
    );
    return liftPlanar(center, dir, side, geometry, normal);
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
 * arrows tangent at both ends, text on the bisector past the arc. The sweep is this
 * system's reading of the label — the reflex when the label sits outside the narrow
 * sector, where the sketch editor would measure the supplement.
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
    const geometry = angleDimension(
        [0, 0],
        // the frame runs down the first direction, so the arc starts on its x axis
        [1, 0],
        sweep,
        planarPoint(vertex, u, v, textPoint),
        annotationSize(scale),
    );
    if (geometry === undefined) return undefined;
    return liftPlanar(vertex, u, v, geometry, normal);
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
    // The dimension is planar: lay it out on the measured line itself — start at the
    // origin, end on the x axis — and lift the result back into the plane.
    const [along, offset] = planarPoint(start, dir, side, textPoint);
    const geometry = distanceDimension([0, 0], [length, 0], { offset, along }, annotationSize(scale));
    if (geometry === undefined) return undefined;
    return liftPlanar(start, dir, side, geometry, normal);
}

/**
 * The point's coordinates in the frame (origin, x, y): its distance along `x`, then
 * along `y`. The planar layouts take their inputs and return their geometry in this
 * frame; everything 3D is a lift of it.
 */
function planarPoint(origin: XYZ, x: XYZ, y: XYZ, point: XYZ): Point2 {
    const relative = point.sub(origin);
    return [relative.dot(x), relative.dot(y)];
}

/**
 * The planar size a layout scale implies: an annotation keeps its text at the drafting
 * ratio, one text height per `DIMENSION_BASE_TEXT_HEIGHT_PX` of furniture.
 */
function annotationSize(scale: number): DimensionSize {
    return { scale, textHeight: TEXT_HEIGHT_PX * scale };
}

/**
 * The planar geometry lifted onto the frame (origin, x, y): `(u, v)` maps to
 * `origin + x·u + y·v`. The result is the planar layout's, vertex for vertex — that is
 * the whole point of the split, so the sketch editor draws exactly what an annotation
 * does, in its own coordinates.
 */
function liftPlanar(origin: XYZ, x: XYZ, y: XYZ, geometry: DimensionGeometry, normal: XYZ): DimensionLayout {
    const at = (u: number, v: number) => origin.add(x.multiply(u)).add(y.multiply(v));
    const segments: number[] = [];
    for (const [u1, v1, u2, v2] of geometry.segments) {
        segments.push(...segment(at(u1, v1), at(u2, v2)));
    }
    const triangles: number[] = [];
    for (const [u, v] of geometry.triangles) {
        const point = at(u, v);
        triangles.push(point.x, point.y, point.z);
    }
    // The text's frame is the planar geometry's own: `textDirection` lifted, and its up
    // axis, which is that direction's left normal in the plane.
    const direction =
        x.multiply(geometry.textDirection[0]).add(y.multiply(geometry.textDirection[1])).normalize() ?? x;
    return {
        segments,
        triangles,
        textPosition: at(geometry.textPosition[0], geometry.textPosition[1]),
        normal,
        direction,
        side: normal.cross(direction).normalize() ?? y,
    };
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

/** Two straight edges with the vertex they meet at and the directions the layout draws. */
export interface AngleGeometry {
    readonly vertex: XYZ;
    /** `vertex + unit direction` along the first edge, oriented toward that edge's visible side. */
    readonly p1: XYZ;
    /** `vertex + unit direction` along the second edge. */
    readonly p2: XYZ;
    /** The angle plane's normal (`d1 × d2`). */
    readonly normal: XYZ;
}

/**
 * The vertex and directions of two straight edges, in world space — shared by the
 * angle command (at pick time) and the annotation's association update, so both
 * derive the same geometry. Undefined for parallel or coincident edges.
 */
export function angleFromLines(first: ResolvedLine, second: ResolvedLine): AngleGeometry | undefined {
    const l1 = lineFrame(first);
    const l2 = lineFrame(second);
    if (l1 === undefined || l2 === undefined) return undefined;

    // Near-parallel lines have no usable vertex: `closestMidpoint` divides by
    // sin²(θ), so a tenth of a degree already magnifies pickup noise by 10⁵.
    const cosine = Math.min(1, Math.abs(l1.direction.dot(l2.direction)));
    if (1 - cosine < MIN_ANGLE_SINE) return undefined;
    const normal = l1.direction.cross(l2.direction).normalize();
    if (normal === undefined) return undefined;

    const vertex = closestMidpoint(l1, l2);
    // Orient each direction toward its edge's visible side of the vertex.
    const d1 = l1.mid.sub(vertex).dot(l1.direction) < 0 ? l1.direction.reverse() : l1.direction;
    const d2 = l2.mid.sub(vertex).dot(l2.direction) < 0 ? l2.direction.reverse() : l2.direction;
    return { vertex, p1: vertex.add(d1), p2: vertex.add(d2), normal };
}

function lineFrame(line: ResolvedLine): { start: XYZ; direction: XYZ; mid: XYZ } | undefined {
    const direction = line.end.sub(line.start).normalize();
    if (direction === undefined) return undefined;
    return { start: line.start, direction, mid: line.start.add(line.end).multiply(0.5) };
}

/** Midpoint of the closest pair of points between two (non-parallel) infinite lines. */
function closestMidpoint(l1: { start: XYZ; direction: XYZ }, l2: { start: XYZ; direction: XYZ }): XYZ {
    const w0 = l1.start.sub(l2.start);
    const b = l1.direction.dot(l2.direction);
    const d = l1.direction.dot(w0);
    const e = l2.direction.dot(w0);
    const denom = 1 - b * b;
    const q1 = l1.start.add(l1.direction.multiply((b * e - d) / denom));
    const q2 = l2.start.add(l2.direction.multiply((e - b * d) / denom));
    return q1.add(q2).multiply(0.5);
}

/**
 * The label's position in a linear dimension's frame, captured from the points the
 * user placed. `normal` pins the dimension plane so a later edit that turns the
 * segment keeps the label on the same side.
 */
export function linearTextPlacement(start: XYZ, end: XYZ, textPoint: XYZ): LinearTextPlacement | undefined {
    const dir = end.sub(start).normalize();
    if (dir === undefined) return undefined;

    const { normal, side } = dimensionPlane(dir, start, textPoint);
    const relative = textPoint.sub(start);
    return {
        along: relative.dot(dir),
        lateral: relative.dot(side),
        normal: { x: normal.x, y: normal.y, z: normal.z },
    };
}

/** The label position a linear placement names on the rebuilt segment. */
export function linearTextPoint(start: XYZ, end: XYZ, placement: LinearTextPlacement): XYZ | undefined {
    const dir = end.sub(start).normalize();
    if (dir === undefined) return undefined;

    // Keep the captured plane's normal but orthogonalize it against the new direction;
    // once the segment turns far enough to swallow it, fall back to a well-defined side.
    const stored = new XYZ(placement.normal);
    let normal = stored.sub(dir.multiply(stored.dot(dir))).normalize();
    if (normal === undefined) {
        const seed = Math.abs(dir.z) < 0.9 ? XYZ.unitZ : XYZ.unitX;
        normal = dir.cross(seed).normalize();
    }
    if (normal === undefined) return undefined;

    const side = normal.cross(dir).normalize();
    if (side === undefined) return undefined;
    return start.add(dir.multiply(placement.along)).add(side.multiply(placement.lateral));
}

/**
 * The label's place in an angular dimension: its distance from the vertex and which
 * side of the first direction the layout actually draws it on.
 *
 * The side must follow the layout, not the raw pick: `angleDimension` flips its arc
 * start by half a turn when the label sits across the bisector of the drawn sweep, so
 * a pick in the reflex sector can still draw on the short sector's side. Reproducing
 * that flip here is what keeps a rebuild from turning the label upside down.
 */
export function angleTextPlacement(
    vertex: XYZ,
    p1: XYZ,
    p2: XYZ,
    textPoint: XYZ,
): AngleTextPlacement | undefined {
    const frame = angleFrame(vertex, p1, p2);
    if (frame === undefined) return undefined;

    const relative = textPoint.sub(vertex);
    // The two bits the layout derives: which sweep it reads (theta2 is in (0, π), so the
    // reflected one is negative) and whether it starts the arc half a turn round.
    const sweep = sweepInFrame(frame, vertex, textPoint);
    const bisector = sweep / 2;
    const toLabel = relative.dot(frame.u) * Math.cos(bisector) + relative.dot(frame.v) * Math.sin(bisector);
    return {
        radius: relative.length(),
        reflex: sweep < 0,
        flip: toLabel < 0,
    };
}

/**
 * A label position that reproduces the stored sweep and flip on the rebuilt angle.
 *
 * The layout always draws the text on the sweep's bisector, so the stored radius plus
 * the two bits fully determine what the user saw. The reconstructed point is a
 * *canonical* one inside the same half-sector: a short sweep takes its bisector, a
 * reflected sweep takes the bisector for `flip = false` and a point in the other half
 * of the reflex sector for `flip = true`. Feeding it back to `sweepInFrame` and the
 * layout's start flip returns the same branch, so both the value and the drawn text
 * survive the rebuild.
 */
export function angleTextPoint(
    vertex: XYZ,
    p1: XYZ,
    p2: XYZ,
    placement: AngleTextPlacement,
): XYZ | undefined {
    const frame = angleFrame(vertex, p1, p2);
    if (frame === undefined) return undefined;

    const at = !placement.reflex
        ? frame.theta2 / 2
        : placement.flip
          ? (3 * frame.theta2) / 4 + Math.PI / 4
          : frame.theta2 / 2 + Math.PI;
    return vertex
        .add(frame.u.multiply(Math.cos(at) * placement.radius))
        .add(frame.v.multiply(Math.sin(at) * placement.radius));
}
