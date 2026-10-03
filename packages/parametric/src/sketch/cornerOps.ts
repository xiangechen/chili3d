// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result, XY } from "@chili3d/core";
import {
    arcAngles,
    ConstraintKind,
    isDatumEntityId,
    pointRefKey,
    type SketchConstraintData,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import { centerRef, lineRefs, tangentConstraintFor } from "./solverEntities";

/**
 * A corner of two sketch lines — the endpoints the two lines share, plus the
 * endpoint each keeps. `jointIds` are the P2PCoincident constraints holding the
 * two corner endpoints together; a fillet/chamfer replaces the corner, so they go
 * with it (the same thing Onshape does when a vertex is consumed).
 */
export interface SketchCorner {
    line1: number;
    line2: number;
    /** line1's endpoint at the corner. */
    ref1: SketchPointRef;
    /** line2's endpoint at the corner. */
    ref2: SketchPointRef;
    /** line1's other endpoint, which the trim leaves in place. */
    far1: SketchPointRef;
    /** line2's other endpoint. */
    far2: SketchPointRef;
    jointIds: number[];
}

export interface FilletCornerOptions {
    readonly method: "fillet";
    /** Fillet radius, in sketch units. */
    readonly radius: number;
}

export interface ChamferCornerOptions {
    readonly method: "chamfer";
    /** Equal setback distance along both lines, in sketch units. */
    readonly distance: number;
}

export type CornerOptions = FilletCornerOptions | ChamferCornerOptions;

/**
 * A dimension an op left behind that wants an explicit label placement: its anchor is
 * a vector from the arc's center, so the caller can put the label on the outside of
 * the corner instead of wherever the shared default happens to fall.
 */
export interface CornerLabel {
    constraintId: number;
    /** From the arc's center toward the outside of the corner. */
    offset: XY;
}

/**
 * Constraints a corner trim cannot break: they read only the line's infinite
 * extent, and cutting the line short along its own direction leaves that extent
 * (and so the residual) untouched. Every other kind either measures a length the
 * trim changes or pins the corner point itself, which stops existing here.
 *
 * The line tangencies belong here too, which is what makes a second pass over the
 * same profile work: a filleted corner leaves a `TangentLineArc` on each of its two
 * lines, and that row's line endpoints include the *far* corner of each — the very
 * point the next fillet trims. Tangency measures the distance from the arc's centre
 * to the infinite line, so sliding that endpoint along the line leaves it satisfied.
 */
const DIRECTION_KINDS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.Horizontal,
    ConstraintKind.Vertical,
    ConstraintKind.Parallel,
    ConstraintKind.Perpendicular,
    ConstraintKind.Angle,
    ConstraintKind.TangentLineCircle,
    ConstraintKind.TangentLineArc,
]);

function toXY(point: [number, number]): XY {
    return new XY(point[0], point[1]);
}

function oppositeIndex(pointIndex: number): number {
    return pointIndex === 0 ? 1 : 0;
}

/**
 * Every corner `lineIds` form among themselves — one per pair of lines sharing an
 * endpoint. Lines that are not lines, or that are datum/external (never movable),
 * drop out. Returns an error instead of silently skipping when a corner exists but
 * cannot be trimmed, so a batch never half-applies.
 */
export function findCorners(
    solver: SketchSolver,
    lineIds: readonly number[],
    tolerance: number,
    method?: CornerOptions["method"],
): Result<SketchCorner[]> {
    const constraints = solver.toData().constraints;
    const lines = [...new Set(lineIds)].filter(
        (id) => solver.entity(id)?.type === "line" && !solver.isFixed(id),
    );
    const corners: SketchCorner[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
            const found = cornerBetween(solver, constraints, lines[i], lines[j], tolerance);
            if (!found.isOk) return Result.err(found.error);
            const corner = found.value;
            if (corner === undefined) continue;
            const confirmed = confirmCorner(solver, constraints, corner, method);
            if (!confirmed.isOk) return Result.err(confirmed.error);
            corners.push(corner);
        }
    }
    return Result.ok(corners);
}

/**
 * Whether the constraint is a length dimension on one of the corner's own edges —
 * the kind a chamfer re-dimensions as it cuts. Only that one is absorbable: a
 * dimension to anything outside the edge would still be left fighting the trim. An
 * expression is not absorbable either: the chamfer writes the length it leaves as a
 * literal over it, which would quietly throw the user's formula away.
 */
function isEdgeLengthDimension(constraint: SketchConstraintData, corner: SketchCorner): boolean {
    if (constraint.kind !== ConstraintKind.P2PDistance || constraint.refs.length !== 2) return false;
    if (typeof constraint.datum !== "number") return false;
    const [a, b] = constraint.refs;
    return a.entityId === b.entityId && (a.entityId === corner.line1 || a.entityId === corner.line2);
}

/**
 * The corner two lines share, or `undefined` when they share none. The coincidence
 * constraint is read first — it names the two endpoints exactly — with a positional
 * comparison as the fallback for lines that were never constrained together.
 */
function cornerBetween(
    solver: SketchSolver,
    constraints: readonly SketchConstraintData[],
    line1: number,
    line2: number,
    tolerance: number,
): Result<SketchCorner | undefined> {
    const joint = constraints.find(
        (c) => c.kind === ConstraintKind.P2PCoincident && joinsLines(c.refs, line1, line2),
    );
    if (joint !== undefined) {
        return Result.ok(cornerFrom(line1, line2, [joint.refs[0], joint.refs[1]], [joint.id]));
    }
    const pairs = endpointPairs(line1, line2).filter(
        ([a, b]) => toXY(solver.pointOf(a)).distanceTo(toXY(solver.pointOf(b))) <= tolerance,
    );
    if (pairs.length === 0) return Result.ok(undefined);
    if (pairs.length > 1) {
        return Result.err("The two lines are coincident end to end — there is no single corner");
    }
    return Result.ok(cornerFrom(line1, line2, pairs[0], []));
}

/** The four ways an endpoint of `line1` can meet one of `line2`. */
function endpointPairs(line1: number, line2: number): [SketchPointRef, SketchPointRef][] {
    const pairs: [SketchPointRef, SketchPointRef][] = [];
    for (const i1 of [0, 1]) {
        for (const i2 of [0, 1]) {
            pairs.push([
                { entityId: line1, pointIndex: i1 },
                { entityId: line2, pointIndex: i2 },
            ]);
        }
    }
    return pairs;
}

/** Whether a two-ref constraint joins one endpoint of each line, whichever way round. */
function joinsLines(refs: readonly SketchPointRef[], line1: number, line2: number): boolean {
    if (refs.length !== 2) return false;
    const ids = refs.map((r) => r.entityId).sort((a, b) => a - b);
    return ids[0] === Math.min(line1, line2) && ids[1] === Math.max(line1, line2);
}

/** Normalizes a corner's two refs so `ref1` belongs to `line1`, and derives the far ends. */
function cornerFrom(
    line1: number,
    line2: number,
    refs: [SketchPointRef, SketchPointRef],
    jointIds: number[],
): SketchCorner {
    const ref1 = refs[0].entityId === line1 ? refs[0] : refs[1];
    const ref2 = ref1 === refs[0] ? refs[1] : refs[0];
    return {
        line1,
        line2,
        ref1,
        ref2,
        far1: { entityId: line1, pointIndex: oppositeIndex(ref1.pointIndex) },
        far2: { entityId: line2, pointIndex: oppositeIndex(ref2.pointIndex) },
        jointIds,
    };
}

/**
 * Whether the corner can be replaced: nothing else may hang off it, and no
 * constraint other than a direction-only one (or the joint being consumed) may
 * reference either endpoint. A chamfer also absorbs the length dimension on an edge
 * it trims (it re-dimensions that edge), so such a dimension is not a blocker for
 * it — which is what lets a profile be chamfered corner by corner over several
 * commands, exactly as one batch already did.
 */
function confirmCorner(
    solver: SketchSolver,
    constraints: readonly SketchConstraintData[],
    corner: SketchCorner,
    method?: CornerOptions["method"],
): Result<void> {
    const own = new Set([corner.line1, corner.line2]);
    // both endpoints, not just ref1: when a joint constraint holds the corner together
    // the two refs share one coincident group, but a corner found positionally has them
    // in separate groups, and an entity hanging off ref2 alone would be dragged along
    for (const ref of [corner.ref1, corner.ref2].flatMap((r) => solver.coincidentGroup(r))) {
        if (own.has(ref.entityId) || isDatumEntityId(ref.entityId)) continue;
        return Result.err("The corner joins another entity — trim that junction first");
    }
    const keys = new Set([pointRefKey(corner.ref1), pointRefKey(corner.ref2)]);
    for (const constraint of constraints) {
        if (!constraint.refs.some((r) => keys.has(pointRefKey(r)))) continue;
        if (constraint.kind === ConstraintKind.P2PCoincident || DIRECTION_KINDS.has(constraint.kind)) {
            continue;
        }
        if (method === "chamfer" && isEdgeLengthDimension(constraint, corner)) continue;
        return Result.err(
            `The corner carries a ${ConstraintKind[constraint.kind]} constraint that the trim would break`,
        );
    }
    return Result.ok(undefined);
}

/**
 * Replaces every corner in `corners` with a fillet or a chamfer, all in one shot:
 * anything that fails — a radius that does not fit, a solve that comes back
 * conflicting — rolls the whole batch back, so the sketch is never left half
 * converted. The caller solves and commits through the editor afterwards.
 *
 * Corners are applied in order rather than all at once: one line can own two of
 * them (one per endpoint), and the second must measure the line as the first left
 * it, or two fillets could each fit alone while together overrunning the line.
 * Returns one label placement per fillet radius; a chamfer has none of its own.
 */
export function applyCornerOps(
    solver: SketchSolver,
    corners: readonly SketchCorner[],
    options: CornerOptions,
): Result<CornerLabel[]> {
    const snapshot = solver.toData();
    const labels: CornerLabel[] = [];
    for (const corner of corners) {
        const applied =
            options.method === "fillet"
                ? applyFillet(solver, corner, options.radius)
                : applyChamfer(solver, corner, options.distance);
        if (!applied.isOk) {
            solver.reset(snapshot);
            return Result.err(applied.error);
        }
        if (applied.value !== undefined) labels.push(applied.value);
    }
    const outcome = solver.solve(true);
    if (outcome.result === "Conflicting" || outcome.result === "Diverged" || outcome.result === "Stalled") {
        solver.reset(snapshot);
        return Result.err(`The sketch could not solve after the change (${outcome.result})`);
    }
    return Result.ok(labels);
}

/** Center plus the two tangent points of the fillet arc at `corner`. */
interface FilletGeometry {
    center: XY;
    /** Tangent point on line1. */
    t1: XY;
    /** Tangent point on line2. */
    t2: XY;
    /** From the center out through the corner — where the radius label belongs. */
    outward: XY;
    /**
     * Whether the arc runs T1 → T2 (so the start sits on line1's ref). The arc's
     * minor sweep is π−θ whichever way the corner turns, and which order gives it
     * depends on the handedness — the coincidences have to follow this.
     */
    startOnLine1: boolean;
}

/** Where the corner sits, which way its two sides run, and the angle between them. */
interface CornerSides {
    p: XY;
    d1: XY;
    d2: XY;
    u1: XY;
    u2: XY;
    /** Between the two side directions, in [0, π]. */
    angle: number;
}

/** The corner's two sides, or an error when one of them is zero-length. */
function cornerSides(solver: SketchSolver, corner: SketchCorner): Result<CornerSides> {
    const p = toXY(solver.pointOf(corner.ref1));
    const d1 = toXY(solver.pointOf(corner.far1)).sub(p);
    const d2 = toXY(solver.pointOf(corner.far2)).sub(p);
    const u1 = d1.normalize();
    const u2 = d2.normalize();
    if (u1 === undefined || u2 === undefined) return Result.err("The corner has a zero-length side");
    return Result.ok({ p, d1, d2, u1, u2, angle: Math.abs(u1.angleTo(u2)!) });
}

/**
 * Whether the two sides lie on one straight line. There is no corner to cut, and a
 * chamfer meeting one would only lay a redundant segment back over the geometry
 * already there, so both ops refuse rather than quietly re-cut it.
 */
function isCollinear(angle: number): boolean {
    return angle < Precision.Angle || Math.PI - angle < Precision.Angle;
}

/**
 * The fillet's center and tangent points, or an error when the corner is
 * degenerate (collinear sides) or the radius does not fit on both segments.
 */
function filletGeometry(solver: SketchSolver, corner: SketchCorner, radius: number): Result<FilletGeometry> {
    if (radius <= Precision.Distance) return Result.err("The fillet radius must be positive");
    const sides = cornerSides(solver, corner);
    if (!sides.isOk) return Result.err(sides.error);
    const { p, d1, d2, u1, u2, angle } = sides.value;
    if (isCollinear(angle)) {
        return Result.err("The two lines are collinear — there is no corner to fillet");
    }
    const half = angle / 2;
    const tangent = radius / Math.tan(half);
    if (tangent > d1.length() - Precision.Distance || tangent > d2.length() - Precision.Distance) {
        return Result.err("The fillet radius is too large for one of the lines");
    }
    const bisector = u1.add(u2).normalize();
    if (bisector === undefined) return Result.err("The corner has no interior");

    const t1 = p.add(u1.multiply(tangent));
    const t2 = p.add(u2.multiply(tangent));
    const center = p.add(bisector.multiply(radius / Math.sin(half)));
    return Result.ok({
        center,
        t1,
        t2,
        // the center sits on the inward bisector, so the corner is straight back along it
        outward: bisector.reverse(),
        startOnLine1: minorSweepStartsAt(center, t1, t2),
    });
}

/**
 * Whether the counter-clockwise arc of the fillet runs T1 → T2. The swept angle is
 * π−θ, but `rawArcSweep` returns π+θ for one order, so the sign cannot pick it:
 * both normalized sweeps are compared and the smaller one — always the minor arc —
 * wins.
 */
function minorSweepStartsAt(center: XY, t1: XY, t2: XY): boolean {
    const swepT1First = arcAngles([center.x, center.y, t1.x, t1.y, t2.x, t2.y])[1];
    const sweepT2First = arcAngles([center.x, center.y, t2.x, t2.y, t1.x, t1.y])[1];
    return swepT1First <= sweepT2First;
}

function applyFillet(
    solver: SketchSolver,
    corner: SketchCorner,
    radius: number,
): Result<CornerLabel | undefined> {
    const geometry = filletGeometry(solver, corner, radius);
    if (!geometry.isOk) return Result.err(geometry.error);
    const { center, t1, t2, outward, startOnLine1 } = geometry.value;

    for (const id of corner.jointIds) solver.removeConstraint(id);
    solver.setPointPosition(corner.ref1, t1.x, t1.y);
    solver.setPointPosition(corner.ref2, t2.x, t2.y);

    const start = startOnLine1 ? t1 : t2;
    const end = startOnLine1 ? t2 : t1;
    const arcId = solver.addArc(center.x, center.y, start.x, start.y, end.x, end.y);

    // the coincidences have to follow the arc's own start/end order
    const startRef: SketchPointRef = { entityId: arcId, pointIndex: startOnLine1 ? 1 : 2 };
    const endRef: SketchPointRef = { entityId: arcId, pointIndex: startOnLine1 ? 2 : 1 };
    solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [corner.ref1, startRef] });
    solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [corner.ref2, endRef] });

    for (const line of [corner.line1, corner.line2]) {
        const tangent = tangentConstraintFor("line", line, "arc", arcId);
        if (tangent === undefined) continue;
        solver.addConstraint({ kind: tangent.kind, refs: tangent.refs });
    }
    // driving dimension, so the fillet stays the size the user asked for
    const constraintId = solver.addConstraint({
        kind: ConstraintKind.Radius,
        refs: [centerRef(arcId)],
        datum: radius,
    });
    return Result.ok({ constraintId, offset: outward.multiply(radius) });
}

function applyChamfer(
    solver: SketchSolver,
    corner: SketchCorner,
    distance: number,
): Result<CornerLabel | undefined> {
    if (distance <= Precision.Distance) return Result.err("The chamfer distance must be positive");
    const sides = cornerSides(solver, corner);
    if (!sides.isOk) return Result.err(sides.error);
    const { p, d1, d2, u1, u2, angle } = sides.value;
    if (isCollinear(angle)) {
        return Result.err("The two lines are collinear — there is no corner to chamfer");
    }
    if (distance > d1.length() - Precision.Distance || distance > d2.length() - Precision.Distance) {
        return Result.err("The chamfer distance is too large for one of the lines");
    }
    // measured before the trim moves the corner: the trimmed edges keep a length dim
    const kept = [d1.length() - distance, d2.length() - distance];
    const lines = [corner.line1, corner.line2];

    const q1 = p.add(u1.multiply(distance));
    const q2 = p.add(u2.multiply(distance));
    for (const id of corner.jointIds) solver.removeConstraint(id);
    solver.setPointPosition(corner.ref1, q1.x, q1.y);
    solver.setPointPosition(corner.ref2, q2.x, q2.y);
    const chamferId = solver.addLine(q1.x, q1.y, q2.x, q2.y);

    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [corner.ref1, { entityId: chamferId, pointIndex: 0 }],
    });
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [corner.ref2, { entityId: chamferId, pointIndex: 1 }],
    });
    // the chamfer's own span, and the two trimmed lengths it cuts back. All three are
    // needed: the lengths alone leave the two cut ends free to pull apart, so the
    // corner opens up (measured: a sketch that starts at 4 DOF and comes back at 8,
    // with the chamfer stretching under a drag), while the span plus one length is
    // still loose.
    solver.addConstraint({
        kind: ConstraintKind.P2PDistance,
        refs: [
            { entityId: chamferId, pointIndex: 0 },
            { entityId: chamferId, pointIndex: 1 },
        ],
        datum: q1.distanceTo(q2),
    });
    for (let i = 0; i < lines.length; i++) {
        pinLength(solver, lines[i], kept[i]);
    }
    return Result.ok(undefined);
}

/**
 * Dimensions a line by its own two endpoints. When one is already there it is either an
 * earlier corner of this same batch or a pre-existing literal dimension on the edge
 * (`confirmCorner` refuses those written as an expression), so it is re-dimensioned to
 * the length the trim leaves — adding a second would be two constraints on one length
 * and the solve would come back conflicting.
 */
function pinLength(solver: SketchSolver, line: number, length: number): void {
    const refs = lineRefs(line);
    const key = refs.map(pointRefKey).sort().join("|");
    const existing = solver
        .toData()
        .constraints.find(
            (c) => c.kind === ConstraintKind.P2PDistance && c.refs.map(pointRefKey).sort().join("|") === key,
        );
    if (existing === undefined) {
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: length });
        return;
    }
    solver.setDatumSource(existing.id, length);
}
