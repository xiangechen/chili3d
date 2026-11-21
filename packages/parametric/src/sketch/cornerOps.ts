// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result, XY } from "@chili3d/core";
import { type SketchOperationResult, SketchSolveError } from "./sketchError";
import {
    arcAngles,
    ConstraintKind,
    entityRadius,
    isDatumEntityId,
    isStructuralConstraint,
    pointRefKey,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import { areParallel, centerRef, lineRefs, tangentConstraintFor } from "./solverEntities";

/** The entity kinds a corner can be cut between. A circle has no corner endpoints. */
const CORNER_TYPES: ReadonlySet<string> = new Set(["line", "arc"]);

export function isCornerEntity(entity: SketchEntityData | undefined): boolean {
    return entity !== undefined && CORNER_TYPES.has(entity.type);
}

/**
 * A corner of two sketch edges — the endpoints the two edges share, plus the
 * endpoint each keeps. `jointIds` are the P2PCoincident constraints holding the
 * two corner endpoints together; a fillet/chamfer replaces the corner, so they go
 * with it (the same thing Onshape does when a vertex is consumed).
 */
export interface SketchCorner {
    entity1: number;
    entity2: number;
    /** entity1's endpoint at the corner. */
    ref1: SketchPointRef;
    /** entity2's endpoint at the corner. */
    ref2: SketchPointRef;
    /** entity1's other endpoint, which the trim leaves in place. */
    far1: SketchPointRef;
    /** entity2's other endpoint. */
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
    /** Setback distance along both edges, in sketch units; on an arc it is arc length. */
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
 * Constraints a corner trim cannot break: they read a direction that the trim leaves
 * untouched. For a line that is its infinite extent — cutting the line short along its
 * own direction keeps it — and for an arc it is its centre and radius, which moving an
 * endpoint along the circle also keeps.
 *
 * The tangencies belong here too, which is what makes a second pass over the same
 * profile work: a filleted corner leaves a `TangentLineArc` (and, when an arc is one of
 * its edges, a `TangentArcArc`) on each of its two edges, and that row's refs include the
 * *far* corner of each — the very point the next fillet trims. Tangency measures a
 * distance between a line and a circle centre, or between two circle centres, neither of
 * which slides when the endpoint does. `TangentCircleArc` and `EqualArcRadius` name an
 * arc's start only for the parameter layout; their residuals read its centre and radius,
 * which is why the edit ops' own `SLIDE_SAFE_REFS` counts both as surviving a slide.
 */
const DIRECTION_KINDS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.Horizontal,
    ConstraintKind.Vertical,
    ConstraintKind.Parallel,
    ConstraintKind.Perpendicular,
    ConstraintKind.Angle,
    ConstraintKind.TangentLineCircle,
    ConstraintKind.TangentLineArc,
    ConstraintKind.TangentCircleArc,
    ConstraintKind.TangentArcArc,
    ConstraintKind.EqualArcRadius,
]);

function toXY(point: [number, number]): XY {
    return new XY(point[0], point[1]);
}

/** The endpoint indices an entity exposes as corner ends (an arc's are start and end). */
function endpointIndexes(entity: SketchEntityData | undefined): number[] {
    if (entity?.type === "arc") return [1, 2];
    return [0, 1];
}

function oppositeIndex(entity: SketchEntityData | undefined, pointIndex: number): number {
    if (entity?.type === "arc") return pointIndex === 1 ? 2 : 1;
    return pointIndex === 0 ? 1 : 0;
}

/**
 * Every corner `entityIds` form among themselves — one per pair of edges sharing an
 * endpoint. Edges that are neither lines nor arcs, or that are datum/external (never
 * movable), drop out. Returns an error instead of silently skipping when a corner exists
 * but cannot be trimmed, so a batch never half-applies.
 */
export function findCorners(
    solver: SketchSolver,
    entityIds: readonly number[],
    tolerance: number,
    method?: CornerOptions["method"],
): Result<SketchCorner[]> {
    const constraints = solver.toData().constraints;
    const entities = [...new Set(entityIds)].filter(
        (id) => isCornerEntity(solver.entity(id)) && !solver.isFixed(id),
    );
    const corners: SketchCorner[] = [];
    let unsupportedArcs = false;
    for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
            // A batch that happens to include an arc-arc corner still converts its other
            // corners; only a pick that has nothing else explains why it cannot.
            if (solver.entity(entities[i])?.type === "arc" && solver.entity(entities[j])?.type === "arc") {
                unsupportedArcs = true;
                continue;
            }
            const found = cornerBetween(solver, constraints, entities[i], entities[j], tolerance);
            if (!found.isOk) return Result.err(found.error);
            const corner = found.value;
            if (corner === undefined) continue;
            const confirmed = confirmCorner(solver, constraints, corner, method);
            if (!confirmed.isOk) return Result.err(confirmed.error);
            corners.push(corner);
        }
    }
    if (corners.length === 0 && unsupportedArcs) {
        return Result.err(
            `${method === "chamfer" ? "Chamfering" : "Filleting"} two arcs is not supported yet`,
        );
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
    return a.entityId === b.entityId && (a.entityId === corner.entity1 || a.entityId === corner.entity2);
}

/**
 * Whether the constraint is the gap between two parallel lines, read as a point-to-line
 * distance — the shape `dimensionInference` makes of a parallel pair (`buildLineGap`), because
 * garlic has no line-to-line distance of its own.
 *
 * A trim leaves it alone for the same reason `DIRECTION_KINDS` are left alone: it reads only
 * the two lines' infinite extents. The trim slides each endpoint along the line it belongs to,
 * and across two lines that stay parallel the gap is the same from anywhere along either one.
 *
 * Unlike those, this cannot be answered by the kind alone. A `P2LDistance` to a line that is
 * *not* parallel is exactly the constraint a trim does break — sliding the point along its own
 * line moves it nearer the other one — so the parallelism is the whole of the test.
 */
function isLineGapDistance(solver: SketchSolver, constraint: SketchConstraintData): boolean {
    if (constraint.kind !== ConstraintKind.P2LDistance || constraint.refs.length !== 3) return false;
    const [point, first, second] = constraint.refs;
    if (first.entityId !== second.entityId) return false;
    return areParallel(solver, point.entityId, first.entityId);
}

/**
 * The corner two edges share, or `undefined` when they share none. The coincidence
 * constraint is read first — it names the two endpoints exactly — with a positional
 * comparison as the fallback for edges that were never constrained together.
 *
 * A pair that meets tangentially is not a corner: the fillet that produced it joins those
 * two edges end to end, and a box-select over the finished profile must not pair them up
 * again. Skipping them is what lets the still-sharp corners of that profile convert in the
 * same batch instead of failing the whole set on a "collinear" error.
 */
function cornerBetween(
    solver: SketchSolver,
    constraints: readonly SketchConstraintData[],
    entity1: number,
    entity2: number,
    tolerance: number,
): Result<SketchCorner | undefined> {
    const joint = constraints.find(
        (c) => c.kind === ConstraintKind.P2PCoincident && joinsEntities(solver, c.refs, entity1, entity2),
    );
    if (joint !== undefined) {
        const corner = cornerFrom(solver, entity1, entity2, [joint.refs[0], joint.refs[1]], [joint.id]);
        return Result.ok(isTangential(solver, corner) ? undefined : corner);
    }
    const pairs = endpointPairs(solver, entity1, entity2).filter(
        ([a, b]) => toXY(solver.pointOf(a)).distanceTo(toXY(solver.pointOf(b))) <= tolerance,
    );
    if (pairs.length === 0) return Result.ok(undefined);
    if (pairs.length > 1) {
        return Result.err("The two edges are coincident end to end — there is no single corner");
    }
    const corner = cornerFrom(solver, entity1, entity2, pairs[0], []);
    return Result.ok(isTangential(solver, corner) ? undefined : corner);
}

/**
 * Whether the two sides leave the corner along one line. Two straight edges keep their
 * old behaviour — a collinear pair is reported by the op rather than silently skipped,
 * because a user may have picked exactly that pair — while a pair involving an arc is a
 * fillet's own handiwork and is skipped.
 */
function isTangential(solver: SketchSolver, corner: SketchCorner): boolean {
    const side1 = cornerSide(solver, corner.entity1, corner.ref1, corner.far1);
    const side2 = cornerSide(solver, corner.entity2, corner.ref2, corner.far2);
    if (!side1.isOk || !side2.isOk) return false;
    if (side1.value.kind === "line" && side2.value.kind === "line") return false;
    const angle = Math.abs(side1.value.direction.angleTo(side2.value.direction)!);
    return angle < Precision.Angle || Math.PI - angle < Precision.Angle;
}

/** Every way an endpoint of `entity1` can meet one of `entity2`. */
function endpointPairs(
    solver: SketchSolver,
    entity1: number,
    entity2: number,
): [SketchPointRef, SketchPointRef][] {
    const pairs: [SketchPointRef, SketchPointRef][] = [];
    for (const i1 of endpointIndexes(solver.entity(entity1))) {
        for (const i2 of endpointIndexes(solver.entity(entity2))) {
            pairs.push([
                { entityId: entity1, pointIndex: i1 },
                { entityId: entity2, pointIndex: i2 },
            ]);
        }
    }
    return pairs;
}

/**
 * Whether a two-ref constraint joins one *endpoint* of each entity, whichever way round.
 * An arc's pointIndex 0 is its centre, so a leftover centre-to-point coincidence (a
 * break or a trim can leave one behind) is not a corner and must not be read as one.
 */
function joinsEntities(
    solver: SketchSolver,
    refs: readonly SketchPointRef[],
    entity1: number,
    entity2: number,
): boolean {
    if (refs.length !== 2) return false;
    if (!refs.every((ref) => endpointIndexes(solver.entity(ref.entityId)).includes(ref.pointIndex))) {
        return false;
    }
    const ids = refs.map((r) => r.entityId).sort((a, b) => a - b);
    return ids[0] === Math.min(entity1, entity2) && ids[1] === Math.max(entity1, entity2);
}

/** Normalizes a corner's two refs so `ref1` belongs to `entity1`, and derives the far ends. */
function cornerFrom(
    solver: SketchSolver,
    entity1: number,
    entity2: number,
    refs: [SketchPointRef, SketchPointRef],
    jointIds: number[],
): SketchCorner {
    const ref1 = refs[0].entityId === entity1 ? refs[0] : refs[1];
    const ref2 = ref1 === refs[0] ? refs[1] : refs[0];
    return {
        entity1,
        entity2,
        ref1,
        ref2,
        far1: { entityId: entity1, pointIndex: oppositeIndex(solver.entity(entity1), ref1.pointIndex) },
        far2: { entityId: entity2, pointIndex: oppositeIndex(solver.entity(entity2), ref2.pointIndex) },
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
 *
 * A gap between two parallel lines is no blocker for either op, since neither can
 * change it (see `isLineGapDistance`). That is what a rectangle's width and height
 * are dimensioned as, by hand and by the draw command alike, so it is what lets a
 * dimensioned rectangle be rounded at all.
 */
function confirmCorner(
    solver: SketchSolver,
    constraints: readonly SketchConstraintData[],
    corner: SketchCorner,
    method?: CornerOptions["method"],
): Result<void> {
    const own = new Set([corner.entity1, corner.entity2]);
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
        if (isLineGapDistance(solver, constraint)) continue;
        // an arc's own structural PointOnArc pins its end to the circle the centre and the
        // start describe; moving that start along the circle keeps the reading true, and
        // the solver rebuilds the row either way. Only the entity's own row qualifies — a
        // user's point-on-arc names an external point first.
        if (isStructuralConstraint(constraint)) continue;
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
 * Corners are applied in order rather than all at once: one edge can own two of
 * them (one per endpoint), and the second must measure the edge as the first left
 * it, or two fillets could each fit alone while together overrunning the edge.
 * Returns one label placement per fillet radius; a chamfer has none of its own.
 */
export function applyCornerOps(
    solver: SketchSolver,
    corners: readonly SketchCorner[],
    options: CornerOptions,
): SketchOperationResult<CornerLabel[]> {
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
        return Result.err(
            new SketchSolveError(`The sketch could not solve after the change (${outcome.result})`),
        );
    }
    return Result.ok(labels);
}

/**
 * One side of a corner: where it starts, which way it leaves, and — for an arc — the
 * circle that side runs on. `length` is the distance the trim may consume, which is an
 * arc length on a circle.
 */
interface CornerSide {
    kind: "line" | "arc";
    entityId: number;
    ref: SketchPointRef;
    far: SketchPointRef;
    point: XY;
    /** Unit direction leaving the corner toward the far end. */
    direction: XY;
    length: number;
    arc?: {
        center: XY;
        radius: number;
        /** Angular travel from the corner to the far end, in (0, 2π]. */
        sweep: number;
        /** +1 when travelling counter-clockwise from the corner, -1 clockwise. */
        turn: 1 | -1;
        /** Angle of the corner point on the circle. */
        angle: number;
    };
}

/** Where the corner sits, which way its two sides run, and the angle between them. */
interface CornerSides {
    p: XY;
    sides: [CornerSide, CornerSide];
    /** Between the two side directions, in [0, π]. */
    angle: number;
}

/** The side data of one corner edge, or an error when the geometry is degenerate. */
function cornerSide(
    solver: SketchSolver,
    entityId: number,
    ref: SketchPointRef,
    far: SketchPointRef,
): Result<CornerSide> {
    const entity = solver.entity(entityId);
    if (entity === undefined || !isCornerEntity(entity)) {
        return Result.err("A corner needs a line or an arc");
    }
    const point = toXY(solver.pointOf(ref));
    const farPoint = toXY(solver.pointOf(far));
    if (entity.type === "line") {
        const d = farPoint.sub(point);
        const direction = d.normalize();
        if (direction === undefined) return Result.err("The corner has a zero-length side");
        return Result.ok({ kind: "line", entityId, ref, far, point, direction, length: d.length() });
    }

    const params = entity.params;
    const center = new XY({ x: params[0], y: params[1] });
    const radius = entityRadius(entity);
    const [startAngle, sweep] = arcAngles(params);
    const fromStart = ref.pointIndex === 1;
    const angle = fromStart ? startAngle : startAngle + sweep;
    const turn: 1 | -1 = fromStart ? 1 : -1;
    // the tangent that leaves the corner the way the arc travels toward its far end
    const direction =
        turn > 0
            ? new XY({ x: -Math.sin(angle), y: Math.cos(angle) })
            : new XY({ x: Math.sin(angle), y: -Math.cos(angle) });
    return Result.ok({
        kind: "arc",
        entityId,
        ref,
        far,
        point,
        direction,
        length: radius * sweep,
        arc: { center, radius, sweep, turn, angle },
    });
}

/** The corner's two sides, or an error when one of them is degenerate. */
function cornerSides(solver: SketchSolver, corner: SketchCorner): Result<CornerSides> {
    const side1 = cornerSide(solver, corner.entity1, corner.ref1, corner.far1);
    if (!side1.isOk) return Result.err(side1.error);
    const side2 = cornerSide(solver, corner.entity2, corner.ref2, corner.far2);
    if (!side2.isOk) return Result.err(side2.error);
    const angle = Math.abs(side1.value.direction.angleTo(side2.value.direction)!);
    return Result.ok({ p: side1.value.point, sides: [side1.value, side2.value], angle });
}

/**
 * Whether the two sides lie on one straight line. There is no corner to cut, and a
 * chamfer meeting one would only lay a redundant segment back over the geometry
 * already there, so both ops refuse rather than quietly re-cut it.
 */
function isCollinear(angle: number): boolean {
    return angle < Precision.Angle || Math.PI - angle < Precision.Angle;
}

/** Center plus the two tangent points of the fillet arc at `corner`. */
interface FilletGeometry {
    center: XY;
    /** Tangent point on entity1. */
    t1: XY;
    /** Tangent point on entity2. */
    t2: XY;
    /** From the center out through the corner — where the radius label belongs. */
    outward: XY;
    /**
     * Whether the arc runs T1 → T2 (so the start sits on entity1's ref). The arc's
     * minor sweep is π−θ whichever way the corner turns, and which order gives it
     * depends on the handedness — the coincidences have to follow this.
     */
    startOnFirst: boolean;
}

/**
 * The fillet of a line-arc corner. The fillet circle has to touch the line (its centre
 * is `radius` off it) and the arc (its centre is `R ± radius` from the arc's), so the
 * centre is where one of the line's offset lines crosses one of those concentric
 * circles. Several solutions exist — both sides of the line, inside or outside the arc —
 * and only the one on the corner's interior survives both tangent points landing on the
 * picked edges.
 */
function lineArcFillet(
    line: CornerSide,
    arcSide: CornerSide,
    radius: number,
): Result<{ center: XY; lineTangent: XY; arcTangent: XY }> {
    const arc = arcSide.arc;
    if (arc === undefined) return Result.err("A corner needs a line or an arc");
    const u = line.direction;
    const n = new XY({ x: -u.y, y: u.x });
    const a = line.point.sub(arc.center);
    const bisector = line.direction.add(arcSide.direction).normalize();
    if (bisector === undefined) return Result.err("The corners are collinear — there is no corner to fillet");

    let best: { center: XY; lineTangent: XY; arcTangent: XY; along: number } | undefined;
    for (const side of [1, -1]) {
        for (const outside of [1, -1]) {
            if (outside < 0 && arc.radius <= radius) continue;
            const b = a.dot(u);
            const c = a.dot(n);
            const disc = b * b - 2 * radius * (side * c - outside * arc.radius);
            if (disc < 0) continue;
            for (const root of [1, -1]) {
                const along = -b + root * Math.sqrt(disc);
                if (along <= Precision.Distance || along > line.length - Precision.Distance) continue;
                const center = line.point.add(u.multiply(along)).add(n.multiply(side * radius));
                const toCenter = center.sub(arc.center);
                const centerDistance = toCenter.length();
                if (Math.abs(centerDistance - (arc.radius + outside * radius)) > Precision.Distance) continue;
                const lineTangent = line.point.add(u.multiply(along));
                const arcTangent = arc.center.add(toCenter.multiply(arc.radius / centerDistance));
                if (!arcPointWithin(arcSide, arcTangent)) continue;
                if (center.sub(line.point).dot(bisector) <= 0) continue;
                if (best === undefined || along < best.along) {
                    best = { center, lineTangent, arcTangent, along };
                }
            }
        }
    }
    if (best === undefined) {
        return Result.err("The fillet radius is too large for one of the edges");
    }
    return Result.ok({ center: best.center, lineTangent: best.lineTangent, arcTangent: best.arcTangent });
}

/** Whether `point` (on the arc's circle) lies between the corner and the arc's far end. */
function arcPointWithin(side: CornerSide, point: XY): boolean {
    const arc = side.arc;
    if (arc === undefined) return false;
    const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x);
    const delta = normalizeAngle((angle - arc.angle) * arc.turn);
    return delta <= arc.sweep + Precision.Angle;
}

function normalizeAngle(angle: number): number {
    const turn = Math.PI * 2;
    return ((angle % turn) + turn) % turn;
}

/**
 * The fillet's centre and tangent points for any supported pair, or an error when the
 * corner is degenerate or the radius does not fit. Two arcs are refused for now: their
 * four tangent combinations need their own selection rule, and a sketch corner between
 * two arcs is rare enough to add after the line-arc case is proven.
 */
function curvedFillet(sides: CornerSides, radius: number): Result<{ center: XY; t1: XY; t2: XY }> {
    const [first, second] = sides.sides;
    if (first.kind === "arc" && second.kind === "arc") {
        return Result.err("Filleting two arcs is not supported yet");
    }
    const line = first.kind === "line" ? first : second;
    const arc = first.kind === "arc" ? first : second;
    const solved = lineArcFillet(line, arc, radius);
    if (!solved.isOk) return Result.err(solved.error);
    return Result.ok(
        first.kind === "line"
            ? { center: solved.value.center, t1: solved.value.lineTangent, t2: solved.value.arcTangent }
            : { center: solved.value.center, t1: solved.value.arcTangent, t2: solved.value.lineTangent },
    );
}

/**
 * The fillet's center and tangent points, or an error when the corner is
 * degenerate (collinear sides) or the radius does not fit on both edges.
 */
function filletGeometry(solver: SketchSolver, corner: SketchCorner, radius: number): Result<FilletGeometry> {
    if (radius <= Precision.Distance) return Result.err("The fillet radius must be positive");
    const sides = cornerSides(solver, corner);
    if (!sides.isOk) return Result.err(sides.error);
    const { p, angle } = sides.value;
    if (isCollinear(angle)) {
        return Result.err("The edges are collinear — there is no corner to fillet");
    }

    let center: XY;
    let t1: XY;
    let t2: XY;
    if (sides.value.sides[0].kind === "line" && sides.value.sides[1].kind === "line") {
        const [side1, side2] = sides.value.sides;
        const half = angle / 2;
        const tangent = radius / Math.tan(half);
        if (tangent > side1.length - Precision.Distance || tangent > side2.length - Precision.Distance) {
            return Result.err("The fillet radius is too large for one of the edges");
        }
        const bisector = side1.direction.add(side2.direction).normalize();
        if (bisector === undefined) return Result.err("The corner has no interior");
        t1 = p.add(side1.direction.multiply(tangent));
        t2 = p.add(side2.direction.multiply(tangent));
        center = p.add(bisector.multiply(radius / Math.sin(half)));
    } else {
        const solved = curvedFillet(sides.value, radius);
        if (!solved.isOk) return Result.err(solved.error);
        center = solved.value.center;
        t1 = solved.value.t1;
        t2 = solved.value.t2;
    }

    const outward = center.sub(p).normalize();
    if (outward === undefined) return Result.err("The corner has no interior");
    return Result.ok({
        center,
        t1,
        t2,
        // the center sits on the inward bisector, so the corner is straight back along it
        outward: outward.reverse(),
        startOnFirst: minorSweepStartsAt(center, t1, t2),
    });
}

/**
 * Whether the counter-clockwise arc of the fillet runs T1 → T2. The swept angle is
 * π−θ, but `rawArcSweep` returns π+θ for one order, so the sign cannot pick it:
 * both normalized sweeps are compared and the smaller one — always the minor arc —
 * wins.
 */
function minorSweepStartsAt(center: XY, t1: XY, t2: XY): boolean {
    const sweepT1First = arcAngles([center.x, center.y, t1.x, t1.y, t2.x, t2.y])[1];
    const sweepT2First = arcAngles([center.x, center.y, t2.x, t2.y, t1.x, t1.y])[1];
    return sweepT1First <= sweepT2First;
}

function applyFillet(
    solver: SketchSolver,
    corner: SketchCorner,
    radius: number,
): Result<CornerLabel | undefined> {
    const geometry = filletGeometry(solver, corner, radius);
    if (!geometry.isOk) return Result.err(geometry.error);
    const { center, t1, t2, outward, startOnFirst } = geometry.value;

    for (const id of corner.jointIds) solver.removeConstraint(id);
    solver.setPointPosition(corner.ref1, t1.x, t1.y);
    solver.setPointPosition(corner.ref2, t2.x, t2.y);

    const start = startOnFirst ? t1 : t2;
    const end = startOnFirst ? t2 : t1;
    const arcId = solver.addArc(center.x, center.y, start.x, start.y, end.x, end.y);

    // the coincidences have to follow the arc's own start/end order
    const startRef: SketchPointRef = { entityId: arcId, pointIndex: startOnFirst ? 1 : 2 };
    const endRef: SketchPointRef = { entityId: arcId, pointIndex: startOnFirst ? 2 : 1 };
    solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [corner.ref1, startRef] });
    solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [corner.ref2, endRef] });

    for (const side of [corner.entity1, corner.entity2]) {
        const entity = solver.entity(side);
        if (entity === undefined || !isCornerEntity(entity)) continue;
        const tangent = tangentConstraintFor(entity.type, side, "arc", arcId);
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

/** The point `distance` along a side from the corner, or undefined when it does not fit. */
function pointAlong(side: CornerSide, distance: number): XY | undefined {
    if (side.kind === "line") {
        if (distance > side.length - Precision.Distance) return undefined;
        return side.point.add(side.direction.multiply(distance));
    }
    const arc = side.arc;
    if (arc === undefined) return undefined;
    const step = distance / arc.radius;
    if (step > arc.sweep - Precision.Angle) return undefined;
    const angle = arc.angle + arc.turn * step;
    return arc.center.add(new XY({ x: Math.cos(angle) * arc.radius, y: Math.sin(angle) * arc.radius }));
}

function applyChamfer(
    solver: SketchSolver,
    corner: SketchCorner,
    distance: number,
): Result<CornerLabel | undefined> {
    if (distance <= Precision.Distance) return Result.err("The chamfer distance must be positive");
    const sides = cornerSides(solver, corner);
    if (!sides.isOk) return Result.err(sides.error);
    const {
        sides: [side1, side2],
        angle,
    } = sides.value;
    if (isCollinear(angle)) {
        return Result.err("The edges are collinear — there is no corner to chamfer");
    }
    if (side1.kind === "arc" && side2.kind === "arc") {
        return Result.err("Chamfering two arcs is not supported yet");
    }
    const q1 = pointAlong(side1, distance);
    const q2 = pointAlong(side2, distance);
    if (q1 === undefined || q2 === undefined) {
        return Result.err("The chamfer distance is too large for one of the edges");
    }

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
    // the chamfer's own span, and the lengths the trim leaves on its neighbours. All are
    // needed: the lengths alone leave the two cut ends free to pull apart, so the
    // corner opens up (measured on lines: a sketch that starts at 4 DOF and comes back
    // at 8, with the chamfer stretching under a drag), while the span plus one length is
    // still loose.
    solver.addConstraint({
        kind: ConstraintKind.P2PDistance,
        refs: [
            { entityId: chamferId, pointIndex: 0 },
            { entityId: chamferId, pointIndex: 1 },
        ],
        datum: q1.distanceTo(q2),
    });
    for (const side of [side1, side2]) {
        if (side.kind === "line") {
            pinLength(solver, side.entityId, side.length - distance);
        } else if (side.arc !== undefined) {
            pinArcChord(solver, side, side.arc.sweep - distance / side.arc.radius);
        }
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

/**
 * The arc counterpart of `pinLength`: garlic has no arc-length constraint, so the sweep
 * the trim leaves is pinned by the chord between the two endpoints. The chord fixes the
 * sweep for a given radius (to its minor reading, which is the one a trim leaves); the
 * radius itself is left to the arc's own centre/start, as every other op leaves it.
 */
function pinArcChord(solver: SketchSolver, side: CornerSide, remainingSweep: number): void {
    const arc = side.arc;
    if (arc === undefined) return;
    const refs = [side.ref, side.far];
    const key = refs.map(pointRefKey).sort().join("|");
    const existing = solver
        .toData()
        .constraints.find(
            (c) => c.kind === ConstraintKind.P2PDistance && c.refs.map(pointRefKey).sort().join("|") === key,
        );
    const chord = 2 * arc.radius * Math.sin(remainingSweep / 2);
    if (existing === undefined) {
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: chord });
        return;
    }
    solver.setDatumSource(existing.id, chord);
}
