// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * uv-space layout for dimension annotations. All sizes derive from `px`
 * (world units per screen pixel) so arrows and gaps keep a constant
 * on-screen size at any zoom level.
 */

export type { DimensionAnchor } from "../sketchModel";

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
    const gap = EXTENSION_GAP_PX * px;
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
