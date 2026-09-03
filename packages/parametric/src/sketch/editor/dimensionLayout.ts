// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * uv-space layout for dimension annotations. All sizes derive from `px`
 * (world units per screen pixel) so arrows and gaps keep a constant
 * on-screen size at any zoom level.
 */

export type { DimensionAnchor } from "../sketchModel";

import { ConstraintKind } from "../sketchModel";

/**
 * Datum value shown in the UI: angles store the signed sweep (the sign picks the
 * side of the first line) and display its magnitude in degrees, point-line
 * distances flip sign (UI: positive = left of the line direction; garlic stores
 * the negated signed distance), everything else as stored.
 */
export function toDisplayDatum(kind: ConstraintKind, value: number): number {
    if (kind === ConstraintKind.Angle) return (Math.abs(value) * 180) / Math.PI;
    if (kind === ConstraintKind.P2LDistance) return -value;
    return value;
}

/**
 * Datum value for the solver: inverse of `toDisplayDatum`. For angles this yields
 * the magnitude in radians — the solver re-attaches the side sign before solving
 * (`SketchSolver.syncAngleDatumSide`).
 */
export function toStorageDatum(kind: ConstraintKind, value: number): number {
    if (kind === ConstraintKind.Angle) return (value * Math.PI) / 180;
    if (kind === ConstraintKind.P2LDistance) return -value;
    return value;
}

export interface DimensionGeometry {
    /** uv-space segments: extension lines, dimension line, arrowhead wings. */
    readonly segments: [number, number, number, number][];
    /** uv position of the dimension text. */
    readonly textPosition: [number, number];
}

const ARROW_LENGTH_PX = 10;
const ARROW_HALF_ANGLE = (20 * Math.PI) / 180;
const EXTENSION_GAP_PX = 3;
const EXTENSION_OVERSHOOT_PX = 4;
const MIN_OFFSET_PX = 14;
const RADIUS_LABEL_MARGIN_PX = 20;
const MIN_ANGLE_RADIUS_PX = 24;
const ANGLE_LABEL_MARGIN_PX = 14;

type Vec2 = [number, number];

/** Signed perpendicular offset of `position` from the segment p1→p2. */
export function segmentOffset(p1: Vec2, p2: Vec2, position: Vec2): number {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return 0;
    // normal = (-dy, dx) / length; offset = (position - p1) · normal
    return ((position[0] - p1[0]) * -dy + (position[1] - p1[1]) * dx) / length;
}

/** Aligned distance dimension: extension lines + dimension line + inward arrows. */
export function distanceDimension(
    p1: Vec2,
    p2: Vec2,
    offset: number,
    px: number,
): DimensionGeometry | undefined {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9 || px <= 0) return undefined;

    const dir: Vec2 = [dx / length, dy / length];
    const normal: Vec2 = [-dir[1], dir[0]];
    const sign = offset >= 0 ? 1 : -1;
    const off = sign * Math.max(Math.abs(offset), MIN_OFFSET_PX * px);
    const at = (p: Vec2, d: number): Vec2 => [p[0] + normal[0] * d, p[1] + normal[1] * d];

    const a = at(p1, off);
    const b = at(p2, off);
    // gap and overshoot follow the offset side, otherwise the extension line
    // starts on the far side of the geometry and crosses it
    const gap = sign * EXTENSION_GAP_PX * px;
    const overshoot = off + sign * EXTENSION_OVERSHOOT_PX * px;

    const segments: DimensionGeometry["segments"] = [
        [...at(p1, gap), ...at(p1, overshoot)],
        [...at(p2, gap), ...at(p2, overshoot)],
        [a[0], a[1], b[0], b[1]],
        // CAD convention: arrow tips touch the extension lines, wings face inward
        ...arrowhead(a, [-dir[0], -dir[1]], px),
        ...arrowhead(b, dir, px),
    ];
    return { segments, textPosition: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
}

/** Radius dimension: leader from the center through the circumference, arrow outward. */
export function radiusDimension(
    center: Vec2,
    radius: number,
    dx: number,
    dy: number,
    px: number,
): DimensionGeometry {
    const length = Math.hypot(dx, dy);
    const dir: Vec2 = length < 1e-9 ? [Math.SQRT1_2, Math.SQRT1_2] : [dx / length, dy / length];
    // respect the chosen label position; only push it out when placed inside the circle
    const labelDistance = length < radius ? radius + RADIUS_LABEL_MARGIN_PX * px : length;
    const label: Vec2 = [center[0] + dir[0] * labelDistance, center[1] + dir[1] * labelDistance];
    const rim: Vec2 = [center[0] + dir[0] * radius, center[1] + dir[1] * radius];

    return {
        segments: [[center[0], center[1], label[0], label[1]], ...arrowhead(rim, dir, px)],
        textPosition: label,
    };
}

/** Two wings pointing backward from `tip`; `outward` is the direction the arrow points to. */
function arrowhead(tip: Vec2, outward: Vec2, px: number): DimensionGeometry["segments"] {
    const length = ARROW_LENGTH_PX * px;
    const cos = Math.cos(ARROW_HALF_ANGLE);
    const sin = Math.sin(ARROW_HALF_ANGLE);
    // backward = -outward, rotated by ±half angle
    const back: Vec2 = [-outward[0], -outward[1]];
    const wing = (s: number): Vec2 => [
        tip[0] + (back[0] * cos - back[1] * sin * s) * length,
        tip[1] + (back[0] * sin * s + back[1] * cos) * length,
    ];
    const w1 = wing(1);
    const w2 = wing(-1);
    return [
        [tip[0], tip[1], w1[0], w1[1]],
        [tip[0], tip[1], w2[0], w2[1]],
    ];
}

function addDir(p: Vec2, dir: Vec2, d: number): Vec2 {
    return [p[0] + dir[0] * d, p[1] + dir[1] * d];
}

/** Foot of the perpendicular from `p` to the infinite line through `l1`–`l2`. */
export function pointLineFoot(p: Vec2, l1: Vec2, l2: Vec2): Vec2 | undefined {
    const dx = l2[0] - l1[0];
    const dy = l2[1] - l1[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-12) return undefined;
    const t = ((p[0] - l1[0]) * dx + (p[1] - l1[1]) * dy) / lengthSquared;
    return [l1[0] + t * dx, l1[1] + t * dy];
}

/** Perpendicular distance from `p` to the infinite line through `l1`–`l2`. */
export function pointLineDistance(p: Vec2, l1: Vec2, l2: Vec2): number {
    return Math.abs(pointLineSignedDistance(p, l1, l2));
}

/** Signed distance: positive when `p` is left of the l1→l2 direction. */
export function pointLineSignedDistance(p: Vec2, l1: Vec2, l2: Vec2): number {
    const dx = l2[0] - l1[0];
    const dy = l2[1] - l1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) return 0;
    return (dx * (p[1] - l1[1]) - dy * (p[0] - l1[0])) / length;
}

/** Intersection of the infinite lines through `a1`–`a2` and `b1`–`b2`; undefined when parallel. */
export function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | undefined {
    const dax = a2[0] - a1[0];
    const day = a2[1] - a1[1];
    const dbx = b2[0] - b1[0];
    const dby = b2[1] - b1[1];
    const denominator = dax * dby - day * dbx;
    if (Math.abs(denominator) < 1e-12) return undefined;
    const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / denominator;
    return [a1[0] + t * dax, a1[1] + t * day];
}

/**
 * Point-to-line distance: dimension line parallel to the point→foot direction,
 * shifted sideways by `offset`; extension lines at the point and the foot.
 */
export function pointLineDistanceDimension(
    p: Vec2,
    l1: Vec2,
    l2: Vec2,
    offset: number,
    px: number,
): DimensionGeometry | undefined {
    const foot = pointLineFoot(p, l1, l2);
    if (foot === undefined || px <= 0) return undefined;
    const length = Math.hypot(p[0] - foot[0], p[1] - foot[1]);
    if (length < 1e-9) return undefined;

    const dir: Vec2 = [(foot[0] - p[0]) / length, (foot[1] - p[1]) / length];
    const normal: Vec2 = [-dir[1], dir[0]];
    const sign = offset >= 0 ? 1 : -1;
    const off = sign * Math.max(Math.abs(offset), MIN_OFFSET_PX * px);
    const a = addDir(p, normal, off);
    const b = addDir(foot, normal, off);
    // gap and overshoot follow the offset side, otherwise the extension line
    // starts on the far side of the geometry and crosses it
    const gap = sign * EXTENSION_GAP_PX * px;
    const overshoot = off + sign * EXTENSION_OVERSHOOT_PX * px;

    return {
        segments: [
            [...addDir(p, normal, gap), ...addDir(p, normal, overshoot)],
            [...addDir(foot, normal, gap), ...addDir(foot, normal, overshoot)],
            [a[0], a[1], b[0], b[1]],
            ...arrowhead(a, [-dir[0], -dir[1]], px),
            ...arrowhead(b, dir, px),
        ],
        textPosition: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
}

/**
 * Horizontal/vertical distance between two points: extension lines from each point
 * to an axis-parallel dimension line placed `offset` off the points' midline.
 */
export function axisDistanceDimension(
    p1: Vec2,
    p2: Vec2,
    axis: "h" | "v",
    offset: number,
    px: number,
): DimensionGeometry | undefined {
    const span = axis === "h" ? p2[0] - p1[0] : p2[1] - p1[1];
    if (Math.abs(span) < 1e-9 || px <= 0) return undefined;

    const base = axis === "h" ? (p1[1] + p2[1]) / 2 : (p1[0] + p2[0]) / 2;
    const sign = offset >= 0 ? 1 : -1;
    const linePosition = base + sign * Math.max(Math.abs(offset), MIN_OFFSET_PX * px);
    const a: Vec2 = axis === "h" ? [p1[0], linePosition] : [linePosition, p1[1]];
    const b: Vec2 = axis === "h" ? [p2[0], linePosition] : [linePosition, p2[1]];
    const dir: Vec2 = axis === "h" ? [1, 0] : [0, 1];
    const out: Vec2 = axis === "h" ? [0, sign] : [sign, 0];
    const gap = EXTENSION_GAP_PX * px;
    const overshoot = EXTENSION_OVERSHOOT_PX * px;

    return {
        segments: [
            [...addDir(p1, out, gap), ...addDir(a, out, overshoot)],
            [...addDir(p2, out, gap), ...addDir(b, out, overshoot)],
            [a[0], a[1], b[0], b[1]],
            ...arrowhead(a, [-dir[0], -dir[1]], px),
            ...arrowhead(b, dir, px),
        ],
        textPosition: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
}

/**
 * Angle between two directions around `vertex`: an arc of pixel-constant minimum
 * radius swept the short way from `d1` to `d2`, arrows tangent at both ends.
 */
export function angleDimension(
    vertex: Vec2,
    d1: Vec2,
    d2: Vec2,
    radius: number,
    px: number,
): DimensionGeometry | undefined {
    if (px <= 0 || Math.hypot(d1[0], d1[1]) < 1e-12 || Math.hypot(d2[0], d2[1]) < 1e-12) return undefined;
    const a1 = Math.atan2(d1[1], d1[0]);
    let sweep = (Math.atan2(d2[1], d2[0]) - a1) % (Math.PI * 2);
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    if (Math.abs(sweep) < 1e-9) return undefined;

    const r = Math.max(radius, MIN_ANGLE_RADIUS_PX * px);
    const arcPoint = (angle: number): Vec2 => [
        vertex[0] + r * Math.cos(angle),
        vertex[1] + r * Math.sin(angle),
    ];
    const segments: DimensionGeometry["segments"] = [];
    const count = Math.max(4, Math.ceil((Math.abs(sweep) / Math.PI) * 16));
    for (let i = 0; i < count; i++) {
        const p0 = arcPoint(a1 + (sweep * i) / count);
        const p1 = arcPoint(a1 + (sweep * (i + 1)) / count);
        segments.push([p0[0], p0[1], p1[0], p1[1]]);
    }
    // tangent direction at an arc end, pointing along the sweep
    const tangent = (angle: number, forward: boolean): Vec2 => {
        const s = (forward ? 1 : -1) * Math.sign(sweep);
        return [-Math.sin(angle) * s, Math.cos(angle) * s];
    };
    segments.push(...arrowhead(arcPoint(a1), tangent(a1, false), px));
    segments.push(...arrowhead(arcPoint(a1 + sweep), tangent(a1 + sweep, true), px));

    const mid = a1 + sweep / 2;
    const labelDistance = r + ANGLE_LABEL_MARGIN_PX * px;
    return {
        segments,
        textPosition: [vertex[0] + labelDistance * Math.cos(mid), vertex[1] + labelDistance * Math.sin(mid)],
    };
}
