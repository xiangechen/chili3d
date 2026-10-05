// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The planar layout of a dimension: extension lines, arrowheads, arc, leader and text
 * anchor for every kind a dimension can be, in one 2D coordinate system with the
 * drafting furniture sized by `DimensionSize.scale`, so arrows and gaps keep a constant
 * on-screen size at any zoom.
 *
 * Both dimension systems draw from here. The sketch editor lays its uv-space dimensions
 * out with these functions directly; the 3D annotations (`model/dimensionLayout`) lift
 * the same result onto the dimension plane. Nothing here knows about either: a `Point2`
 * is uv or millimetres depending on the caller, and the caller's own frame decides which
 * way the arrowheads fan.
 */

// The drafting furniture every dimension draws with: arrows, gaps and the minimum
// standoff, all "px" at the base text height below. Both dimension systems and the 3D
// annotations' own sizes derive from these.
export const DIMENSION_BASE_TEXT_HEIGHT_PX = 12;
export const DIMENSION_ARROW_LENGTH_PX = 10;
export const DIMENSION_ARROW_HALF_ANGLE = (20 * Math.PI) / 180;
export const DIMENSION_EXTENSION_GAP_PX = 3;
export const DIMENSION_EXTENSION_OVERSHOOT_PX = 4;
export const DIMENSION_MIN_OFFSET_PX = 14;
export const DIMENSION_RADIAL_LABEL_MARGIN_PX = 20;
export const DIMENSION_MIN_ANGLE_RADIUS_PX = 24;
export const DIMENSION_ANGLE_LABEL_MARGIN_PX = 14;

/** A point in the caller's plane: uv for the sketch editor, millimetres for an annotation. */
export type Point2 = [number, number];

/**
 * How big a dimension draws. `scale` sizes the drafting furniture — arrows, gaps, the
 * minimum offset — and is the caller's world units per screen pixel, which is why the
 * sketch passes its `px` while the 3D annotations pass `textHeight / 12`; `textHeight` is
 * the height the caller draws the glyphs at, which the text anchor stands off by half.
 */
export interface DimensionSize {
    readonly scale: number;
    readonly textHeight: number;
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
 * Where a linear dimension's label sits, in the measured line's own frame so it follows
 * the geometry: `offset` across the line (which side the dimension line is drawn on),
 * `along` down it from the first reference point. Persisted with the constraint.
 */
export interface DimensionLabel {
    readonly offset: number;
    /**
     * Distance from the first reference point along the dimension line, clamped into
     * the segment. Absent on labels placed before the field existed: those keep the
     * middle of the line, where they have always drawn.
     */
    readonly along?: number;
}

export interface DimensionGeometry {
    /** uv-space segments: extension lines, dimension line / leader / arc polyline. */
    readonly segments: [number, number, number, number][];
    /** uv-space solid arrowheads: flat corner list, three corners per triangle. */
    readonly triangles: [number, number][];
    /** uv position of the dimension text — centered, raised half a text height off the line. */
    readonly textPosition: [number, number];
    /** Unit vector along the text baseline (the dimension line / leader / arc tangent). */
    readonly textDirection: [number, number];
}

/** The drawing channels the annotation graphics are collected into. */
export interface DimensionGraphics {
    readonly segments: DimensionGeometry["segments"];
    readonly triangles: DimensionGeometry["triangles"];
}

/** Appends one dimension's geometry to the collected channels. */
export function pushDimensionGeometry(target: DimensionGraphics, geometry: DimensionGeometry): void {
    target.segments.push(...geometry.segments);
    target.triangles.push(...geometry.triangles);
}

/** A label this close to a sector boundary may be read as belonging to either side. */
const SECTOR_BOUNDARY_EPS = 1e-9;

/** Signed sweep (radians, in (−π, π]) from `d1` to `d2`; the sign records which side of `d1` that `d2` sits on. */
export function signedSweep(d1: Point2, d2: Point2): number {
    const sweep = (Math.atan2(d2[1], d2[0]) - Math.atan2(d1[1], d1[0])) % (Math.PI * 2);
    if (sweep > Math.PI) return sweep - Math.PI * 2;
    if (sweep < -Math.PI) return sweep + Math.PI * 2;
    return sweep;
}

/**
 * Whether an angle dimension between two lines measures the supplement of the angle
 * from `d1` to `d2`: true when the label sits in one of the two sectors that pair does
 * not cover. Two lines cut four sectors of two magnitudes, and the label's sector is
 * what decides which pair the dimension takes — Creo's rule for the sketcher:
 * "dimension placement determines whether the acute or the obtuse angle is measured".
 * Reversing the second line's refs is how that choice is stored, so the solver, the arc
 * and the text all read it off the geometry afterwards.
 */
export function measuresSupplement(d1: Point2, d2: Point2, labelDirection: Point2): boolean {
    const sweep = signedSweep(d1, d2);
    const angle = Math.abs(sweep);
    // parallel directions cut no sectors: there is no supplement to take
    if (angle < SECTOR_BOUNDARY_EPS) return false;
    const from = Math.atan2(d1[1], d1[0]);
    const to = Math.atan2(labelDirection[1], labelDirection[0]);
    // the label's offset from d1, wrapped into [0, 2π) in the sweep's own sense
    const offset = wrap(to - from, sweep > 0);
    // the swept sector covers [0, angle]; the narrow sector facing it starts at π
    return !(
        offset <= angle + SECTOR_BOUNDARY_EPS ||
        (offset >= Math.PI - SECTOR_BOUNDARY_EPS && offset <= Math.PI + angle + SECTOR_BOUNDARY_EPS)
    );
}

/** `angle` wrapped into [0, 2π), read the other way round — negated — when `counterClockwise` is false. */
function wrap(angle: number, counterClockwise: boolean): number {
    const signed = counterClockwise ? angle : -angle;
    return ((signed % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

/** Text anchor on the dimension line, raised half a text height toward `side` (unit). */
function textAnchor(midpoint: Point2, side: Point2, size: DimensionSize): Point2 {
    const raise = size.textHeight / 2;
    return [midpoint[0] + side[0] * raise, midpoint[1] + side[1] * raise];
}

/** Signed perpendicular offset of `position` from the segment p1→p2. */
export function segmentOffset(p1: Point2, p2: Point2, position: Point2): number {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return 0;
    // normal = (-dy, dx) / length; offset = (position - p1) · normal
    return ((position[0] - p1[0]) * -dy + (position[1] - p1[1]) * dx) / length;
}

/** How far `position` lies along the segment p1→p2, clamped into it. */
export function segmentAlong(p1: Point2, p2: Point2, position: Point2): number {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return 0;
    const along = ((position[0] - p1[0]) * dx + (position[1] - p1[1]) * dy) / length;
    return Math.min(Math.max(along, 0), length);
}

/**
 * The label frame of a pick on the measured segment p1→p2 — the inverse of the
 * layout's text placement, so what the user picks is what draws.
 */
export function labelOnSegment(p1: Point2, p2: Point2, label: Point2): DimensionLabel {
    return { offset: segmentOffset(p1, p2, label), along: segmentAlong(p1, p2, label) };
}

/**
 * The label frame of a pick on a horizontal/vertical dimension: `offset` across the
 * axis from the two points' midline, `along` from the first point along the axis.
 * That frame runs along the axis, not from one point to the other, so `along` goes
 * negative when the second point sits behind the first.
 */
export function labelOnAxis(p1: Point2, p2: Point2, axis: "h" | "v", label: Point2): DimensionLabel {
    const index = axis === "h" ? 0 : 1;
    const across = axis === "h" ? 1 : 0;
    const near = Math.min(p1[index], p2[index]);
    const far = Math.max(p1[index], p2[index]);
    return {
        offset: label[across] - (p1[across] + p2[across]) / 2,
        along: Math.min(Math.max(label[index], near), far) - p1[index],
    };
}

/**
 * The point on the dimension line a→b a label sits at: `along` from `a`, or the
 * middle when the label carries none — where labels placed before `along` existed
 * have always drawn. Either end clamps, so a stored position can never pull the
 * text off the line when the geometry shrinks under it.
 */
function labelPointOn(a: Point2, b: Point2, along: number | undefined): Point2 {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return a;
    const t = Math.min(Math.max((along ?? length / 2) / length, 0), 1);
    return [a[0] + dx * t, a[1] + dy * t];
}

/**
 * Aligned distance dimension: extension lines + dimension line + inward arrows.
 * `offset` places the dimension line, `along` the label along it — the 3D
 * counterpart gets both of those out of its picked text point.
 */
export function distanceDimension(
    p1: Point2,
    p2: Point2,
    label: DimensionLabel,
    size: DimensionSize,
): DimensionGeometry | undefined {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9 || size.scale <= 0) return undefined;

    const dir: Point2 = [dx / length, dy / length];
    const normal: Point2 = [-dir[1], dir[0]];
    const { sign, off, gap, overshoot } = dimensionOffsets(label.offset, size.scale);
    const at = (p: Point2, d: number): Point2 => [p[0] + normal[0] * d, p[1] + normal[1] * d];

    const a = at(p1, off);
    const b = at(p2, off);

    const segments: DimensionGeometry["segments"] = [
        [...at(p1, gap), ...at(p1, overshoot)],
        [...at(p2, gap), ...at(p2, overshoot)],
        [a[0], a[1], b[0], b[1]],
    ];
    // CAD convention: arrow tips touch the extension lines, pointing outward
    const triangles = [...arrowhead(a, [-dir[0], -dir[1]], size.scale), ...arrowhead(b, dir, size.scale)];
    return {
        segments,
        triangles,
        textPosition: textAnchor(labelPointOn(a, b, label.along), [normal[0] * sign, normal[1] * sign], size),
        textDirection: dir,
    };
}

/**
 * Radius dimension: leader from the center through the circumference out to the label,
 * with the arrowhead sitting on the rim and pointing back at the center — the leader
 * says what is measured, the arrow says where from.
 * `labelOffset` is the picked label relative to the center — its direction is the
 * leader's, its length the label's distance. A label within
 * `DIMENSION_RADIAL_LABEL_MARGIN_PX` of the rim is pushed out past it, so the text never
 * sits on the circle.
 */
export function radiusDimension(
    center: Point2,
    radius: number,
    labelOffset: Point2,
    size: DimensionSize,
): DimensionGeometry {
    const [dx, dy] = labelOffset;
    const length = Math.hypot(dx, dy);
    const dir: Point2 = length < 1e-9 ? [Math.SQRT1_2, Math.SQRT1_2] : [dx / length, dy / length];
    const labelDistance = Math.max(length, radius + DIMENSION_RADIAL_LABEL_MARGIN_PX * size.scale);
    const label: Point2 = [center[0] + dir[0] * labelDistance, center[1] + dir[1] * labelDistance];
    const rim: Point2 = [center[0] + dir[0] * radius, center[1] + dir[1] * radius];

    return {
        segments: [[center[0], center[1], label[0], label[1]]],
        // `-dir`: the base sits out along the leader, leaving the apex on the rim
        // turned back toward the center
        triangles: arrowhead(rim, [-dir[0], -dir[1]], size.scale),
        // the label stands off the leader's side, half a text height up
        textPosition: textAnchor(label, [-dir[1], dir[0]], size),
        textDirection: dir,
    };
}

/**
 * Diameter dimension: the same leader direction as `radiusDimension`, but drawn across
 * the circle rather than out from its center. Both arrowheads sit on the rim — one on
 * each side of the center — and point outward, so what is measured is the full width and
 * not the distance to the center.
 *
 * One segment runs from the far rim, through the center, out past the near rim and on to
 * the label: `radiusDimension`'s leader, continued through to the other side. The label
 * always stands clear of the rim (`DIMENSION_RADIAL_LABEL_MARGIN_PX`), so the leader is
 * never a separate piece that might come loose from the line it belongs to.
 *
 * The value this measures is twice a `Radius` constraint's datum: the sketch has no
 * diameter constraint of its own, so a diameter is a reading of a radius, not a
 * different measurement.
 */
export function diameterDimension(
    center: Point2,
    radius: number,
    labelOffset: Point2,
    size: DimensionSize,
): DimensionGeometry {
    const [dx, dy] = labelOffset;
    const length = Math.hypot(dx, dy);
    const dir: Point2 = length < 1e-9 ? [Math.SQRT1_2, Math.SQRT1_2] : [dx / length, dy / length];
    const labelDistance = Math.max(length, radius + DIMENSION_RADIAL_LABEL_MARGIN_PX * size.scale);
    const label: Point2 = [center[0] + dir[0] * labelDistance, center[1] + dir[1] * labelDistance];
    const near: Point2 = [center[0] - dir[0] * radius, center[1] - dir[1] * radius];
    const far: Point2 = [center[0] + dir[0] * radius, center[1] + dir[1] * radius];

    return {
        segments: [[near[0], near[1], label[0], label[1]]],
        // both apexes on the rim, both pointing outward: each base sits one arrow length
        // in toward the center, which is `-outward` for the near side and `outward` for
        // the far one (arrowhead lays its base along `-outward` from the tip)
        triangles: [...arrowhead(near, [-dir[0], -dir[1]], size.scale), ...arrowhead(far, dir, size.scale)],
        textPosition: textAnchor(label, [-dir[1], dir[0]], size),
        textDirection: dir,
    };
}

/**
 * A solid triangle: `tip` on the measured geometry, the base corners one arrow
 * length back along `outward` — the silhouette of the drafting open arrowhead,
 * filled, fanning into the left normal of `outward`.
 */
function arrowhead(tip: Point2, outward: Point2, scale: number): [number, number][] {
    const length = DIMENSION_ARROW_LENGTH_PX * scale;
    const cos = Math.cos(DIMENSION_ARROW_HALF_ANGLE);
    const sin = Math.sin(DIMENSION_ARROW_HALF_ANGLE);
    // backward = -outward, rotated by ±half angle
    const back: Point2 = [-outward[0], -outward[1]];
    const corner = (s: number): Point2 => [
        tip[0] + (back[0] * cos - back[1] * sin * s) * length,
        tip[1] + (back[0] * sin * s + back[1] * cos) * length,
    ];
    return [[tip[0], tip[1]], corner(1), corner(-1)];
}

function addDir(p: Point2, dir: Point2, d: number): Point2 {
    return [p[0] + dir[0] * d, p[1] + dir[1] * d];
}

/** Foot of the perpendicular from `p` to the infinite line through `l1`–`l2`. */
export function pointLineFoot(p: Point2, l1: Point2, l2: Point2): Point2 | undefined {
    const dx = l2[0] - l1[0];
    const dy = l2[1] - l1[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-12) return undefined;
    const t = ((p[0] - l1[0]) * dx + (p[1] - l1[1]) * dy) / lengthSquared;
    return [l1[0] + t * dx, l1[1] + t * dy];
}

/** Perpendicular distance from `p` to the infinite line through `l1`–`l2`. */
export function pointLineDistance(p: Point2, l1: Point2, l2: Point2): number {
    return Math.abs(pointLineSignedDistance(p, l1, l2));
}

/** Signed distance: positive when `p` is left of the l1→l2 direction. */
export function pointLineSignedDistance(p: Point2, l1: Point2, l2: Point2): number {
    const dx = l2[0] - l1[0];
    const dy = l2[1] - l1[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) return 0;
    return (dx * (p[1] - l1[1]) - dy * (p[0] - l1[0])) / length;
}

/** Intersection of the infinite lines through `a1`–`a2` and `b1`–`b2`; undefined when parallel. */
export function lineIntersection(a1: Point2, a2: Point2, b1: Point2, b2: Point2): Point2 | undefined {
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
 * The vertex an angle dimension between two lines is laid out around: their
 * intersection, or — parallel lines, which cut no vertex — the centroid of the four
 * points, so an arc that cannot be placed at a real corner still has a reference.
 */
export function angleVertex(a1: Point2, a2: Point2, b1: Point2, b2: Point2): Point2 {
    return (
        lineIntersection(a1, a2, b1, b2) ?? [
            (a1[0] + a2[0] + b1[0] + b2[0]) / 4,
            (a1[1] + a2[1] + b1[1] + b2[1]) / 4,
        ]
    );
}

/**
 * Point-to-line distance: dimension line parallel to the point→foot direction,
 * shifted sideways by the label's `offset`; extension lines at the point and the foot.
 */
export function pointLineDistanceDimension(
    p: Point2,
    l1: Point2,
    l2: Point2,
    label: DimensionLabel,
    size: DimensionSize,
): DimensionGeometry | undefined {
    const foot = pointLineFoot(p, l1, l2);
    if (foot === undefined || size.scale <= 0) return undefined;
    const length = Math.hypot(p[0] - foot[0], p[1] - foot[1]);
    if (length < 1e-9) return undefined;

    const dir: Point2 = [(foot[0] - p[0]) / length, (foot[1] - p[1]) / length];
    const normal: Point2 = [-dir[1], dir[0]];
    const { sign, off, gap, overshoot } = dimensionOffsets(label.offset, size.scale);
    const a = addDir(p, normal, off);
    const b = addDir(foot, normal, off);

    return {
        segments: [
            [...addDir(p, normal, gap), ...addDir(p, normal, overshoot)],
            [...addDir(foot, normal, gap), ...addDir(foot, normal, overshoot)],
            [a[0], a[1], b[0], b[1]],
        ],
        triangles: [...arrowhead(a, [-dir[0], -dir[1]], size.scale), ...arrowhead(b, dir, size.scale)],
        textPosition: textAnchor(labelPointOn(a, b, label.along), [normal[0] * sign, normal[1] * sign], size),
        textDirection: dir,
    };
}

/**
 * Horizontal/vertical distance between two points: extension lines from each point
 * to an axis-parallel dimension line placed off the points' midline.
 */
export function axisDistanceDimension(
    p1: Point2,
    p2: Point2,
    axis: "h" | "v",
    label: DimensionLabel,
    size: DimensionSize,
): DimensionGeometry | undefined {
    const span = axis === "h" ? p2[0] - p1[0] : p2[1] - p1[1];
    if (Math.abs(span) < 1e-9 || size.scale <= 0) return undefined;

    const base = axis === "h" ? (p1[1] + p2[1]) / 2 : (p1[0] + p2[0]) / 2;
    const { sign, off } = dimensionOffsets(label.offset, size.scale);
    const linePosition = base + off;
    const a: Point2 = axis === "h" ? [p1[0], linePosition] : [linePosition, p1[1]];
    const b: Point2 = axis === "h" ? [p2[0], linePosition] : [linePosition, p2[1]];
    const dir: Point2 = axis === "h" ? [1, 0] : [0, 1];
    // `out` carries the sign, so gap and overshoot stay unsigned here
    const out: Point2 = axis === "h" ? [0, sign] : [sign, 0];
    const gap = DIMENSION_EXTENSION_GAP_PX * size.scale;
    const overshoot = DIMENSION_EXTENSION_OVERSHOOT_PX * size.scale;
    const coordinate = axisLabelCoordinate(
        axis === "h" ? p1[0] : p1[1],
        axis === "h" ? p2[0] : p2[1],
        label.along,
    );
    const textPoint: Point2 = axis === "h" ? [coordinate, linePosition] : [linePosition, coordinate];

    return {
        segments: [
            [...addDir(p1, out, gap), ...addDir(a, out, overshoot)],
            [...addDir(p2, out, gap), ...addDir(b, out, overshoot)],
            [a[0], a[1], b[0], b[1]],
        ],
        triangles: [...arrowhead(a, [-dir[0], -dir[1]], size.scale), ...arrowhead(b, dir, size.scale)],
        textPosition: textAnchor(textPoint, out, size),
        textDirection: dir,
    };
}

/**
 * The axis coordinate a label sits at: `along` from the first point, clamped between
 * the two. No `along` means the middle of the span, whichever way it runs.
 */
function axisLabelCoordinate(first: number, second: number, along: number | undefined): number {
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    return Math.min(Math.max(first + (along ?? (second - first) / 2), near), far);
}

/**
 * Angle around `vertex` from `d1`, swept by `sweep`: an arc of pixel-constant minimum
 * radius with arrows tangent at both ends, the text on the bisector just past the arc.
 *
 * `sweep` is the caller's, because the two systems read a label in a wide sector
 * differently — the sketch editor measures the supplement (≤ 180°, as its solver stores
 * it, see `measuresSupplement`) while a 3D annotation sweeps the reflex (`sweepInFrame`).
 * What they share is the drawing. The arc always lands on the side `labelPoint` sits, so
 * an angle and its complement are never drawn across the vertex from the pick.
 */
export function angleDimension(
    vertex: Point2,
    d1: Point2,
    sweep: number,
    labelPoint: Point2,
    size: DimensionSize,
): DimensionGeometry | undefined {
    if (size.scale <= 0 || Math.hypot(d1[0], d1[1]) < 1e-12 || Math.abs(sweep) < 1e-9) return undefined;
    let a1 = Math.atan2(d1[1], d1[0]);

    const toLabel: Point2 = [labelPoint[0] - vertex[0], labelPoint[1] - vertex[1]];
    const bisector = a1 + sweep / 2;
    // the sector facing this one starts half a turn around and sweeps the same way
    if (toLabel[0] * Math.cos(bisector) + toLabel[1] * Math.sin(bisector) < 0) a1 += Math.PI;

    const r = Math.max(Math.hypot(toLabel[0], toLabel[1]), DIMENSION_MIN_ANGLE_RADIUS_PX * size.scale);
    const arcPoint = (angle: number): Point2 => [
        vertex[0] + r * Math.cos(angle),
        vertex[1] + r * Math.sin(angle),
    ];
    const segments = arcPolyline(vertex, r, a1, sweep);
    // tangent direction at an arc end, pointing along the sweep
    const tangent = (angle: number, forward: boolean): Point2 => {
        const s = (forward ? 1 : -1) * Math.sign(sweep);
        return [-Math.sin(angle) * s, Math.cos(angle) * s];
    };
    const triangles = [
        ...arrowhead(arcPoint(a1), tangent(a1, false), size.scale),
        ...arrowhead(arcPoint(a1 + sweep), tangent(a1 + sweep, true), size.scale),
    ];

    const mid = a1 + sweep / 2;
    const labelDistance = r + DIMENSION_ANGLE_LABEL_MARGIN_PX * size.scale;
    return {
        segments,
        triangles,
        textPosition: [vertex[0] + labelDistance * Math.cos(mid), vertex[1] + labelDistance * Math.sin(mid)],
        // the text stands on the arc: baseline along the clockwise tangent at its midpoint
        textDirection: [Math.sin(mid), -Math.cos(mid)],
    };
}

function arcPolyline(vertex: Point2, r: number, a1: number, sweep: number): DimensionGeometry["segments"] {
    const arcPoint = (angle: number): Point2 => [
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
    return segments;
}
