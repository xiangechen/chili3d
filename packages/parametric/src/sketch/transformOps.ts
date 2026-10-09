// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
import { nurbsWeights, sampleEntity } from "./curveEval";
import { isBroken } from "./entityEditOps";
import {
    arcAngles,
    ConstraintKind,
    entityPointCount,
    entityRadius,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
} from "./sketchModel";
import type { SketchSolver, SolveOutcome } from "./solver";

/**
 * The sketch transform: moving the selected entities as one rigid body — shifted, turned
 * about a base, and scaled about that same base. It is the one edit that does not build
 * on what the sketch already says, so it is also the one that has to answer for every
 * relation it invalidates.
 *
 * The selection is transformed exactly, not dragged: the new positions are written
 * straight into the solver and solved once. That is what lets a quarter turn be exact
 * (see `swapQuarterTurn`) instead of a converged approximation, and it is why a relation
 * the transform cannot hold is *dropped* rather than fought over — the same answer
 * Onshape documents for a directed dimension whose direction a rotation took away.
 * Relations that survive the move are kept, so a sketch of surviving constraints stays a
 * sketch of constraints.
 *
 * The op mirrors `mirrorOps.ts` / `offsetOps.ts`: pure geometry plus direct solver
 * mutation, rolled back on any failure, with the caller solving and committing afterwards.
 */

/** Scale and rotate about `base`, then shift: the whole of what the tool does to a point. */
export interface SketchTransform {
    /** Sketch units along +u. */
    readonly du: number;
    /** Sketch units along +v. */
    readonly dv: number;
    /** Radians, counter-clockwise about the base. */
    readonly angle: number;
    /** Uniform, about the base. Positive — a negative one is a reflection and needs the mirror's own answers. */
    readonly scale: number;
}

export interface TransformOutcome {
    /** The entities the transform moved, in source order. */
    readonly movedEntityIds: number[];
    /** Constraint ids dropped because the moved geometry could not hold them. */
    readonly removedConstraintIds: number[];
    /** Axis-aligned relations re-stated for a quarter turn (see `swapQuarterTurn`). */
    readonly swappedConstraintIds: number[];
}

/**
 * How close to 90°/270° a rotation has to be for the axis-aligned relations to swap. Judged
 * on the requested angle, not on the solved geometry: the request is exact by construction,
 * and reading it back after a solve would let a converged 89.99° masquerade as a quarter turn.
 */
const QUARTER_TURN_EPSILON = 1e-9;

/** How many rounds of "drop what garlic names, solve again" a transform is given. */
const MAX_CONFLICT_PASSES = 8;

/**
 * How small a change counts as no change at all. Tighter than `Precision.Angle` (1e-3 rad,
 * ~0.06°) on purpose: that one answers "is this angle worth distinguishing", while this one
 * answers "did the user ask for anything" — and a tenth of a degree is a real request.
 */
const NO_CHANGE_ANGLE = 1e-9;

/**
 * The axis-aligned relations and what a quarter turn makes of each. Only the ones that
 * carry no datum: a `HorizontalDistance` measures along an axis the rotation takes the
 * geometry off, so there is no re-statement of it that stays the same dimension — it goes
 * through the conflict pass instead, which is Onshape's own answer for directed dimensions.
 */
const QUARTER_TURN_SWAP = new Map<ConstraintKind, ConstraintKind>([
    [ConstraintKind.Horizontal, ConstraintKind.Vertical],
    [ConstraintKind.Vertical, ConstraintKind.Horizontal],
    [ConstraintKind.HorizontalAlign, ConstraintKind.VerticalAlign],
    [ConstraintKind.VerticalAlign, ConstraintKind.HorizontalAlign],
]);

/** The relations measured against the sketch's own axes rather than against the geometry. */
const AXIS_ALIGNED_KINDS = new Set<ConstraintKind>([
    ConstraintKind.Horizontal,
    ConstraintKind.Vertical,
    ConstraintKind.HorizontalAlign,
    ConstraintKind.VerticalAlign,
]);

/** The dimensions read along one axis, whose datum a turn takes the geometry off the axis of. */
const DIRECTED_DISTANCE_KINDS = new Set<ConstraintKind>([
    ConstraintKind.HorizontalDistance,
    ConstraintKind.VerticalDistance,
]);

/** The dimensions that name a length the geometry has, which a scale changes out from under them. */
const LENGTH_DIMENSION_KINDS = new Set<ConstraintKind>([
    ConstraintKind.P2PDistance,
    ConstraintKind.Radius,
    ConstraintKind.P2LDistance,
]);

/** A point of the plane under the transform. */
export function transformPoint(
    point: readonly [number, number],
    base: readonly [number, number],
    transform: SketchTransform,
): [number, number] {
    const cos = Math.cos(transform.angle);
    const sin = Math.sin(transform.angle);
    const dx = (point[0] - base[0]) * transform.scale;
    const dy = (point[1] - base[1]) * transform.scale;
    return [base[0] + cos * dx - sin * dy + transform.du, base[1] + sin * dx + cos * dy + transform.dv];
}

/**
 * The entity's points in `pointIndex` order — the order `setPointPosition` and the
 * coincidence groups address them by. Every type lays its points out as the leading
 * pairs of its params (a circle's radius and a conic's rho trail as scalars of their
 * own), so the layout is the count, not the type. Exported because it *is* the
 * params-to-pointIndex layout, which the array needs to write an instance's params
 * back through the point setters.
 */
export function entityPoints(entity: SketchEntityData): [number, number][] {
    const points: [number, number][] = [];
    for (let pointIndex = 0; pointIndex < entityPointCount(entity); pointIndex++) {
        points.push([entity.params[pointIndex * 2], entity.params[pointIndex * 2 + 1]]);
    }
    return points;
}

/**
 * One entity's transformed params, in its own layout. A circle's radius is a param of its
 * own and has to be scaled with it; an arc's is ‖start − centre‖ and comes along with its
 * points. A conic's rho and a NURBS' weights trail the same way but are dimensionless, so
 * a similarity leaves them alone — they are carried, not transformed. An arc's orientation
 * survives a positive scale, so — unlike a mirror — its start and end keep their places.
 */
export function transformParams(
    entity: SketchEntityData,
    base: readonly [number, number],
    transform: SketchTransform,
): number[] {
    const points = entityPoints(entity).map((point) => transformPoint(point, base, transform));
    if (entity.type === "circle") {
        return [...points[0], entity.params[2] * transform.scale];
    }
    if (entity.type === "conic") {
        return [...points.flat(), entity.params[6]];
    }
    if (entity.type === "nurbs") {
        return [...points.flat(), ...nurbsWeights(entity.params)];
    }
    return points.flat();
}

/**
 * The corners that bound an entity, for the base: a circle bounds by its own reach, and an
 * arc by the extremes it sweeps through — its centre and ends alone would bound a half turn
 * no taller than its chord, sitting the triad on the string rather than on the bow. The
 * curve families have no such closed form handy, so they bound by a sampled polyline —
 * near enough for where the triad sits.
 */
function boundsCorners(entity: SketchEntityData): [number, number][] {
    if (entity.type === "circle") {
        const [cx, cy, r] = entity.params;
        return [
            [cx - r, cy - r],
            [cx + r, cy + r],
        ];
    }
    if (entity.type === "line") return entityPoints(entity);
    if (entity.type !== "arc") {
        // the free curves and the ellipse family: no closed form handy, so bound by a sampled
        // polyline — near enough for where the triad sits
        return sampleEntity(entity, 48);
    }
    const corners = entityPoints(entity);
    const [cx, cy] = entity.params;
    const radius = entityRadius(entity);
    const [start, sweep] = arcAngles(entity.params);
    // the four cardinal extremes, when the counter-clockwise sweep from the start crosses them
    for (let quarter = 0; quarter < 4; quarter++) {
        const angle = (quarter * Math.PI) / 2;
        const turned = (angle - start) % (Math.PI * 2);
        const intoSweep = turned < 0 ? turned + Math.PI * 2 : turned;
        if (intoSweep <= sweep) {
            corners.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
        }
    }
    return corners;
}

/**
 * The entities the transform may move: real geometry, each id once, in the order given.
 * Datum and external entities drop out — neither is the solver's to move (its setters
 * refuse them outright).
 */
function movableEntities(solver: SketchSolver, ids: readonly number[]): SketchEntityData[] {
    const seen = new Set<number>();
    const entities: SketchEntityData[] = [];
    for (const id of ids) {
        if (seen.has(id) || solver.isFixed(id)) continue;
        seen.add(id);
        const entity = solver.entity(id);
        if (entity !== undefined) entities.push(entity);
    }
    return entities;
}

/**
 * The base the transform turns and scales about — and where the tool's handles sit: the
 * centre of the selection's bounding box. A base inside the selection is what keeps a
 * quarter turn looking like a rotation rather than a trip across the sketch. `undefined`
 * when the selection holds nothing movable.
 */
export function transformBase(solver: SketchSolver, ids: readonly number[]): [number, number] | undefined {
    const entities = movableEntities(solver, ids);
    if (entities.length === 0) return undefined;
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const entity of entities) {
        for (const [u, v] of boundsCorners(entity)) {
            minU = Math.min(minU, u);
            minV = Math.min(minV, v);
            maxU = Math.max(maxU, u);
            maxV = Math.max(maxV, v);
        }
    }
    return [(minU + maxU) / 2, (minV + maxV) / 2];
}

/** Whether the transform would leave the sketch as it is — nothing to commit, nothing to preview. */
export function isIdentityTransform(transform: SketchTransform): boolean {
    return (
        Math.abs(transform.du) <= Precision.Distance &&
        Math.abs(transform.dv) <= Precision.Distance &&
        Math.abs(transform.angle) <= NO_CHANGE_ANGLE &&
        Math.abs(transform.scale - 1) <= Precision.Float
    );
}

/**
 * The extent a scale of zero would take from the entity — what `scalingProblem` guards.
 * A circle or an arc answers its radius; an ellipse its longer semi-axis; a conic or a
 * nurbs the spread of its control points (the furthest pair), which is the only size a
 * has before it is evaluated.
 */
function entityExtent(entity: SketchEntityData): number {
    if (entity.type === "circle" || entity.type === "arc") return entityRadius(entity);
    const points = entityPoints(entity);
    if (entity.type === "ellipse" || entity.type === "ellipseArc") {
        const major = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
        const minor = Math.hypot(points[2][0] - points[0][0], points[2][1] - points[0][1]);
        return Math.max(major, minor);
    }
    let spread = 0;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            spread = Math.max(spread, Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]));
        }
    }
    return spread;
}

/** Why the entity cannot come through the transform, or `undefined` when it can. */
function scalingProblem(entity: SketchEntityData, transform: SketchTransform): string | undefined {
    if (entity.type === "line") return undefined;
    if (entityExtent(entity) * transform.scale <= Precision.Distance) {
        return "The scale would collapse the sketch geometry";
    }
    return undefined;
}

/**
 * Whether the rotation is an exact quarter turn, where an axis-aligned relation swaps
 * rather than breaks. Without the swap a `Horizontal` line rotated 90° is simply pulled
 * back onto the horizontal by its own constraint — the rotation would not take at all.
 */
function isQuarterTurn(transform: SketchTransform): boolean {
    return Math.abs(Math.cos(transform.angle)) <= QUARTER_TURN_EPSILON;
}

/**
 * The relations that live wholly inside the moved set, and whether it takes the rotation off
 * the sketch's own axes. 0° and 180° leave an axis-aligned relation alone; a quarter turn
 * swaps it (see `QUARTER_TURN_SWAP`), and every other angle takes it away.
 */
function axisTurned(transform: SketchTransform): boolean {
    return Math.abs(Math.sin(transform.angle)) > NO_CHANGE_ANGLE;
}

/**
 * Whether a rigid move of the whole set takes the relation away — so that holding it would
 * mean dragging the geometry back to where it came from, which is what the solver does when
 * left to itself.
 *
 * What survives a move is what is measured against the moved geometry itself: a distance, an
 * angle, an equality, a tangency, an incidence, a symmetry. What does not is what is measured
 * against something the move does not carry — the sketch's own axes (an axis-aligned relation,
 * a directed dimension) or the absolute frame (a `Fix`). A scale additionally changes the
 * lengths the geometry has, so every length dimension goes with it.
 */
function breaksUnderMove(kind: ConstraintKind, transform: SketchTransform): boolean {
    if (kind === ConstraintKind.Fix) return true;
    if (AXIS_ALIGNED_KINDS.has(kind)) return axisTurned(transform);
    const scaled = Math.abs(transform.scale - 1) > Precision.Float;
    if (DIRECTED_DISTANCE_KINDS.has(kind)) {
        // a signed distance along an axis: any turn at all takes the geometry off it, and a
        // half turn reverses which side the pair sits on
        return scaled || Math.abs(transform.angle) > NO_CHANGE_ANGLE;
    }
    if (LENGTH_DIMENSION_KINDS.has(kind)) return scaled;
    return false;
}

/** What a move left of the moved set's own relations: the ones re-stated, and the ones dropped. */
interface RelationOutcome {
    readonly swapped: number[];
    readonly dropped: number[];
}

/**
 * Settles the relations that live wholly inside the moved set. An axis-aligned one a quarter
 * turn re-states keeps its id, so the dimension anchor keyed to it survives; one the move
 * breaks outright goes, because the solver would otherwise satisfy it by undoing the move.
 *
 * A relation that also holds a point outside the set is left alone: the moved side has
 * genuinely moved, and letting the solver carry the unmoved side along is what a drag does —
 * and if it cannot, the conflict pass is told so by garlic itself.
 */
function reconcileRelations(
    solver: SketchSolver,
    sources: readonly SketchEntityData[],
    transform: SketchTransform,
): RelationOutcome {
    const moved = new Set(sources.map((entity) => entity.id));
    const swapped: number[] = [];
    const dropped: number[] = [];
    for (const constraint of solver.toData().constraints) {
        if (!constraint.refs.every((ref) => moved.has(ref.entityId))) continue;
        const swap = QUARTER_TURN_SWAP.get(constraint.kind);
        if (swap !== undefined && isQuarterTurn(transform)) {
            if (solver.replaceConstraint(constraint.id, { ...restOf(constraint), kind: swap })) {
                swapped.push(constraint.id);
            }
            continue;
        }
        if (breaksUnderMove(constraint.kind, transform)) {
            solver.removeConstraint(constraint.id);
            dropped.push(constraint.id);
        }
    }
    return { swapped, dropped };
}

/** A constraint's data without its id, for `replaceConstraint`. */
function restOf(constraint: SketchConstraintData): Omit<SketchConstraintData, "id"> {
    const { id: _id, ...rest } = constraint;
    return rest;
}

/** What the sketch solved to before the transform touched anything — see `reconcile`. */
interface ReconcileBaseline {
    readonly result: SolveOutcome["result"];
    readonly conflicting: ReadonlySet<number>;
}

/**
 * Solves the moved sketch and, while garlic reports conflicts, drops the constraints it
 * names and solves again — then answers with the ids dropped. A conflict is not this op's
 * own failure: the transform simply cannot hold both the new geometry and that relation,
 * and the relation is what gives way. An unsolvable state garlic names nothing for
 * (`Diverged`, `Stalled`) is a state the sketch must not be left in, so the snapshot comes
 * back and the caller reports it.
 *
 * The baseline is what keeps the op honest about which conflicts are its own. One the
 * sketch already carried is not the transform's to drop — it would be forgotten and
 * reported as the move's cost, anchors and all — and a sketch that came in broken and
 * leaves broken is its own problem, not a failure to roll back over (the same bargain
 * `guardedEdit` makes for the curve ops).
 */
function reconcile(
    solver: SketchSolver,
    snapshot: SketchData,
    baseline: ReconcileBaseline,
): Result<number[]> {
    const dropped: number[] = [];
    let result = solver.solve(true).result;
    for (let pass = 0; pass < MAX_CONFLICT_PASSES && isBroken(result); pass++) {
        // garlic keys the report off a solve, so this reads the one just run — and only a
        // conflict the move itself raised is dropped, never one the sketch already had
        const conflicting = solver.diagnose().conflicting.filter((id) => !baseline.conflicting.has(id));
        if (conflicting.length === 0) break;
        for (const id of conflicting) {
            solver.removeConstraint(id);
            dropped.push(id);
        }
        result = solver.solve(true).result;
    }
    if (isBroken(result) && !isBroken(baseline.result)) {
        solver.reset(snapshot);
        return Result.err(`The sketch could not solve after the transform (${result})`);
    }
    return Result.ok(dropped);
}

/** Moves the entity onto its transformed points, radius and all. */
function applyTo(
    solver: SketchSolver,
    entity: SketchEntityData,
    base: readonly [number, number],
    t: SketchTransform,
): void {
    entityPoints(entity).forEach((point, pointIndex) => {
        const [u, v] = transformPoint(point, base, t);
        solver.setPointPosition({ entityId: entity.id, pointIndex }, u, v);
    });
    if (entity.type === "circle") solver.setRadius(entity.id, entity.params[2] * t.scale);
}

/**
 * Transforms `ids` about `base`, keeping every relation the moved geometry can still hold
 * and dropping the ones it cannot. `base` is the caller's — the session computes it once so
 * the preview and the op work about the same point, rather than each deriving its own.
 *
 * The caller solves and commits: this op solves only so a move the solver cannot hold is
 * rolled back here rather than left half-applied in the sketch. The solve before anything
 * moves is the baseline `reconcile` drops new conflicts against — a conflict the sketch
 * already has is not the transform's to answer for.
 */
export function transformEntities(
    solver: SketchSolver,
    ids: readonly number[],
    base: readonly [number, number],
    transform: SketchTransform,
): Result<TransformOutcome> {
    // a negative scale is a reflection: its arcs would need the mirror's start/end swap,
    // so it is refused here rather than silently turning the geometry inside out
    if (transform.scale <= Precision.Float) return Result.err("The scale must be positive");
    if (isIdentityTransform(transform)) return Result.err("Nothing to transform");
    const sources = movableEntities(solver, ids);
    if (sources.length === 0) return Result.err("Nothing to transform");
    for (const source of sources) {
        const problem = scalingProblem(source, transform);
        if (problem !== undefined) return Result.err(problem);
    }

    const baselineResult = solver.solve(true).result;
    const baseline: ReconcileBaseline = {
        result: baselineResult,
        conflicting: new Set(isBroken(baselineResult) ? solver.diagnose().conflicting : []),
    };
    const snapshot = solver.toData();
    const relations = reconcileRelations(solver, sources, transform);
    for (const source of sources) {
        applyTo(solver, source, base, transform);
    }

    const reconciled = reconcile(solver, snapshot, baseline);
    if (!reconciled.isOk) return Result.err(reconciled.error);
    return Result.ok({
        movedEntityIds: sources.map((entity) => entity.id),
        removedConstraintIds: [...relations.dropped, ...reconciled.value],
        swappedConstraintIds: relations.swapped,
    });
}

/**
 * The moved geometry as entity data in sketch coordinates — the preview and the op decide
 * it through the same `transformParams` and the same base, so a preview can never show a
 * move the op would not make. The ids are the sources' own: nothing addresses a preview
 * entity, it is only ever meshed.
 */
export function transformPreview(
    solver: SketchSolver,
    ids: readonly number[],
    base: readonly [number, number],
    transform: SketchTransform,
): SketchEntityData[] {
    return movableEntities(solver, ids).map((entity) => ({
        id: entity.id,
        type: entity.type,
        params: transformParams(entity, base, transform),
        ...(solver.isConstruction(entity.id) ? { construction: true } : {}),
    }));
}
