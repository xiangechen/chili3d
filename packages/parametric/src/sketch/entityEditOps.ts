// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import type { CurveCrossing } from "./curveGeometry";
import {
    ConstraintKind,
    isDatumEntityId,
    isStructuralConstraint,
    pointRefKey,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver, SolveOutcome } from "./solver";
import { arcStartRef, centerRef, lineRefs, tangentConstraintFor } from "./solverEntities";

/**
 * The edits a curve op makes through the solver, shared by the sketch's trim, extend and
 * break. Each of them moves or creates an endpoint and has to answer the same three
 * questions: what does the new endpoint hold on to, which constraints does the moved one
 * have to give up, and how does a carved-up entity hand its constraints on. The answers
 * live here once; the ops themselves keep their own plan and their own arithmetic.
 *
 * `guardedEdit` is the other half of the bargain: every op runs inside it, so a failure —
 * its own, or a solve it broke — puts the sketch back the way it was.
 */

/** What a curve edit left behind, in the terms the editor has to clean up after. */
export interface EditOutcome {
    /** Entities the edit left in place: the picked one, plus a split's new half. */
    entityIds: number[];
    /** Constraint ids the edit removed — their dimension anchors are orphans now. */
    removedConstraints: number[];
    /** Entity ids the edit deleted outright: nothing of the picked entity was left. */
    deletedEntities: number[];
}

/**
 * Runs `work` against the solver with the whole sketch as a safety net: a failure — its own,
 * or a solve it broke — restores the snapshot. `label` names the op in the error, so the
 * user is told which tool left the sketch unsolvable.
 *
 * A sketch whose constraints already conflict is not this op's doing, so only a solve the
 * edit itself broke is worth rolling back.
 */
export function guardedEdit<T>(solver: SketchSolver, label: string, work: () => Result<T>): Result<T> {
    const baseline = solver.solve(true).result;
    const snapshot = solver.toData();
    const outcome = work();
    if (!outcome.isOk) {
        solver.reset(snapshot);
        return Result.err(outcome.error);
    }
    const solved = solver.solve(true);
    if (isBroken(solved.result) && !isBroken(baseline)) {
        solver.reset(snapshot);
        return Result.err(`The sketch could not solve after ${label} (${solved.result})`);
    }
    return outcome;
}

/** Whether a solve result is a failure the op has to answer for, rather than a warning. */
export function isBroken(result: SolveOutcome["result"]): boolean {
    return result === "Conflicting" || result === "Diverged" || result === "Stalled";
}

// ------------------------------------------------------------------ Endpoints the edits create

/**
 * Attaches a freshly created or moved endpoint to the entity that cut it, so the two
 * stay together when either is edited later. A cut landing on the cutter's own end is
 * common enough (a T-junction) that the incidence becomes a coincidence there — the
 * same point-to-point / point-to-object choice `autoConstraints` makes when a drawn
 * point snaps onto geometry, and the one FreeCAD's trim documents.
 */
export function pinCut(
    solver: SketchSolver,
    ref: SketchPointRef,
    cut: CurveCrossing,
    tolerance: number,
): void {
    const onEnd = cutterEndAt(solver, cut.cutter, cut.point, tolerance);
    if (onEnd !== undefined) {
        solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [ref, onEnd] });
        return;
    }
    switch (cut.cutter.type) {
        case "line":
            // a datum axis is a line stored as its own unit segment, but read as the
            // infinite line it is drawn as — the same refs serve both
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [ref, ...lineRefs(cut.cutter.id)],
            });
            return;
        case "circle":
            solver.addConstraint({
                kind: ConstraintKind.PointOnCircle,
                refs: [ref, centerRef(cut.cutter.id)],
            });
            return;
        case "arc":
            solver.addConstraint({
                kind: ConstraintKind.PointOnArc,
                refs: [ref, centerRef(cut.cutter.id), arcStartRef(cut.cutter.id)],
            });
            return;
    }
}

/** The cutter's own point ref at `point`, when the cut landed on one of its ends. */
function cutterEndAt(
    solver: SketchSolver,
    cutter: SketchEntityData,
    point: [number, number],
    tolerance: number,
): SketchPointRef | undefined {
    // A datum axis is the infinite line it is drawn as, so a cut on it is never a cut on
    // one of its points. The unit segment it is *stored* as has ends all the same — (1, 0)
    // on X, (0, 1) on Y — and they are not geometry: reading one as a cutter end would
    // fuse the new endpoint to a spot nobody picked, where the axis itself calls for a
    // point-on-line that stays free to slide along it.
    if (isDatumEntityId(cutter.id)) return undefined;
    // a circle's only point is its centre, which no crossing point can be
    const indices = cutter.type === "line" ? [0, 1] : cutter.type === "arc" ? [1, 2] : [];
    for (const pointIndex of indices) {
        const ref = { entityId: cutter.id, pointIndex };
        const [u, v] = solver.pointOf(ref);
        if (Math.hypot(u - point[0], v - point[1]) <= tolerance) return ref;
    }
    return undefined;
}

// ------------------------------------------------------------------ Constraint preservation

/**
 * Which ref of a constraint may move without breaking it: the point sits in a
 * *line-endpoint or arc-radius* slot, and every such constraint reads that geometry
 * through the line's infinite extent or the arc's radius — both of which sliding the
 * point along its own curve leaves alone. The garlic residuals are the evidence
 * (PointOnLine is the cross product of the two directions, P2LDistance a distance to
 * the infinite line, the tangent kinds distances to it, the arc kinds ‖start−centre‖),
 * and the kinds left out are left out on the same evidence: Midpoint measures the
 * segment between the two points, EqualLength compares two such segments, and the
 * distance kinds read the points themselves. A kind absent here is dropped when a ref
 * of its moves.
 */
const SLIDE_SAFE_REFS: ReadonlyMap<ConstraintKind, ReadonlySet<number>> = new Map([
    [ConstraintKind.Horizontal, new Set([0, 1])],
    [ConstraintKind.Vertical, new Set([0, 1])],
    [ConstraintKind.Parallel, new Set([0, 1, 2, 3])],
    [ConstraintKind.Perpendicular, new Set([0, 1, 2, 3])],
    [ConstraintKind.Angle, new Set([0, 1, 2, 3])],
    [ConstraintKind.PointOnLine, new Set([1, 2])],
    [ConstraintKind.P2LDistance, new Set([1, 2])],
    [ConstraintKind.Symmetric, new Set([2, 3])],
    [ConstraintKind.TangentLineCircle, new Set([0, 1])],
    [ConstraintKind.TangentLineArc, new Set([0, 1, 3])],
    [ConstraintKind.TangentCircleArc, new Set([2])],
    [ConstraintKind.TangentArcArc, new Set([1, 3])],
    [ConstraintKind.EqualArcRadius, new Set([1, 3])],
    [ConstraintKind.PointOnArc, new Set([2])],
]);

/** Whether `ref` sits in a slot whose constraint outlives the point sliding along its curve. */
function survivesSlide(constraint: SketchConstraintData, ref: SketchPointRef): boolean {
    const safe = SLIDE_SAFE_REFS.get(constraint.kind);
    if (safe === undefined) return false;
    const key = pointRefKey(ref);
    return constraint.refs.some((r, index) => safe.has(index) && pointRefKey(r) === key);
}

/**
 * Drops the constraints an endpoint that slid along its own curve can no longer honour:
 * those reading that endpoint, except the ones an extent or a radius protects (see
 * `survivesSlide`) and the entity's own structural constraint, which is part of the
 * entity rather than a user constraint. Returns the removed ids so the caller can
 * report them and prune their dimension anchors.
 *
 * A coincidence with a neighbour's endpoint is one of the casualties, deliberately: the
 * endpoint being slid is the one the user aimed at, so the neighbour stays where it is
 * and the junction opens — the trim's and the extend's shared answer to an edit that
 * would otherwise drag geometry the user did not touch.
 */
export function dropBrokenConstraints(solver: SketchSolver, movedRef: SketchPointRef): number[] {
    const dropped: number[] = [];
    const key = pointRefKey(movedRef);
    for (const constraint of solver.toData().constraints) {
        if (isStructuralConstraint(constraint)) continue;
        if (!constraint.refs.some((ref) => pointRefKey(ref) === key)) continue;
        if (survivesSlide(constraint, movedRef)) continue;
        solver.removeConstraint(constraint.id);
        dropped.push(constraint.id);
    }
    return dropped;
}

// ------------------------------------------------------------------ Carving an entity in two

/**
 * The far half as an entity of its own, from the cut to the end the original had. It
 * inherits everything the half is rather than just its shape: the construction flag, and
 * for an arc the shared centre — without that the second arc's radius is an independent
 * unknown and the pieces drift apart under a drag.
 */
export function addFarHalf(
    solver: SketchSolver,
    entity: SketchEntityData,
    start: [number, number],
    end: [number, number],
): number {
    const newId =
        entity.type === "line"
            ? solver.addLine(start[0], start[1], end[0], end[1])
            : solver.addArc(entity.params[0], entity.params[1], start[0], start[1], end[0], end[1]);
    if (solver.isConstruction(entity.id)) solver.setConstruction(newId, true);
    if (entity.type === "arc") {
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [centerRef(entity.id), centerRef(newId)],
        });
    }
    return newId;
}

/**
 * Moves a carved entity's constraints onto the halves that now hold their points. Only
 * the far endpoint changed owner — it is still the same point, at the same
 * coordinates, so its constraints follow it to the new half. Everything else,
 * including constraints spanning the cut, still reads the points it always read and
 * stays satisfied.
 *
 * The direction kinds are the exception worth correcting: on the original line they
 * meant "this line runs this way", and left spanning the gap they would pin the
 * virtual segment between the two far ends instead, leaving both halves free to
 * swing. They are re-stated once per half, so both keep the orientation the original
 * had.
 *
 * The half that keeps the entity's own refs is that very constraint re-stated — the
 * kept half *is* the original entity — so it goes back under the same id and keeps its
 * dimension anchor; only the new half's copy is a new constraint. Nothing is dropped
 * here, so nothing needs its anchor forgotten.
 */
export function migrateConstraints(
    solver: SketchSolver,
    entity: SketchEntityData,
    far: SketchPointRef,
    newId: number,
): void {
    const farKey = pointRefKey(far);
    for (const constraint of solver.toData().constraints) {
        if (isStructuralConstraint(constraint)) continue;
        if (!constraint.refs.some((ref) => pointRefKey(ref) === farKey)) continue;
        const spansBothHalves = constraint.refs.some(
            (ref) => ref.entityId === entity.id && pointRefKey(ref) !== farKey,
        );
        if (!DIRECTION_KINDS.has(constraint.kind) || !spansBothHalves) {
            // the far point keeps its identity, and it now lives on the new half
            solver.replaceConstraint(constraint.id, {
                ...constraint,
                refs: constraint.refs.map((ref) =>
                    pointRefKey(ref) === farKey ? { ...ref, entityId: newId } : ref,
                ),
            });
            continue;
        }
        solver.replaceConstraint(constraint.id, halfVersion(constraint, entity, entity.id));
        solver.addConstraint(halfVersion(constraint, entity, newId));
    }
}

/**
 * The fields a constraint's *reading* lives in: how a dimension is written rather than what
 * it holds — a radius-or-diameter, a driven dimension's reach. They describe the annotation
 * the user placed, not the geometry an op moves, so every re-statement of a constraint
 * carries them along. Dropping `driven` is the one that bites: the copy would quietly come
 * back as a dimension that *holds* the geometry, which is the opposite of what was asked for.
 */
type ConstraintReading = Pick<SketchConstraintData, "datum" | "datums" | "display" | "driven">;

/** A constraint's reading (see `ConstraintReading`), absent fields left absent. */
function readingOf(constraint: SketchConstraintData): ConstraintReading {
    return {
        ...(constraint.datum === undefined ? {} : { datum: constraint.datum }),
        ...(constraint.datums === undefined ? {} : { datums: constraint.datums }),
        ...(constraint.display === undefined ? {} : { display: constraint.display }),
        ...(constraint.driven === true ? { driven: true } : {}),
    };
}

/**
 * The direction constraint as it reads on one half of a split: the refs belonging to
 * the split entity follow that half, every other ref stays where it was. Stating it
 * per half is what keeps both halves pointing the way the original line did.
 */
function halfVersion(
    constraint: SketchConstraintData,
    entity: SketchEntityData,
    half: number,
): Omit<SketchConstraintData, "id"> {
    return {
        kind: constraint.kind,
        refs: constraint.refs.map((ref) =>
            ref.entityId === entity.id ? { entityId: half, pointIndex: ref.pointIndex } : ref,
        ),
        ...readingOf(constraint),
    };
}

/**
 * The direction kinds a split has to re-state per half (see `migrateConstraints`).
 * They are exactly the kinds whose garlic residual reads the line's two points as a
 * *direction*; a kind that measures their distance cannot be split this way and is
 * simply carried over, which is correct because the split moves no point.
 */
const DIRECTION_KINDS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.Horizontal,
    ConstraintKind.Vertical,
    ConstraintKind.Parallel,
    ConstraintKind.Perpendicular,
    ConstraintKind.Angle,
]);

// ------------------------------------------------------------------ Circle → arc constraints

/**
 * A circle's constraint as the same relation on the arc it became. Only the kinds
 * naming the circle as a *curve* need converting — anything reading just its centre
 * point is untouched, since the centre is the one point the retype preserves.
 * `undefined` is a relation the arc cannot carry: an equal radius against another
 * circle has no arc form, so the retype drops it rather than failing.
 *
 * The reading rides along untouched (see `ConstraintReading`), in both its parts: a radius
 * reading (Ø or R) is kept as the user wrote it — an arc dimensioned from scratch reads R
 * (`buildRadiusReading`), but the retype moves geometry, and an annotation is not geometry —
 * and a driven dimension stays the measurement the user asked for rather than becoming one
 * that holds the arc.
 */
export function circleToArcConstraint(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
): Omit<SketchConstraintData, "id"> | undefined {
    const carried = { kind: constraint.kind, refs: constraint.refs, ...readingOf(constraint) };
    switch (constraint.kind) {
        // rebuilt by the solver itself, as a point distance over centre and start
        case ConstraintKind.Radius:
            return carried;
        case ConstraintKind.PointOnCircle:
            return constraint.refs[1]?.entityId === id ? pointOnArcVersion(constraint.refs[0], id) : carried;
        case ConstraintKind.EqualRadius:
            return equalArcRadiusVersion(solver, constraint, id);
        case ConstraintKind.TangentLineCircle:
        case ConstraintKind.TangentLineArc:
        case ConstraintKind.TangentCircleCircle:
        case ConstraintKind.TangentCircleArc:
        case ConstraintKind.TangentArcArc:
            return convertedTangent(solver, constraint, id);
        default:
            return carried;
    }
}

/** A point held on the circle stays held on the arc that carries the same circle. */
function pointOnArcVersion(point: SketchPointRef, id: number): Omit<SketchConstraintData, "id"> {
    return { kind: ConstraintKind.PointOnArc, refs: [point, centerRef(id), arcStartRef(id)] };
}

/**
 * The equal radius as an arc-to-arc one — the only form left once one side is an arc.
 * `undefined` when the other side is still a circle: `EqualRadius` cannot name an arc
 * (it reads the radius param an arc does not have) and `EqualArcRadius` cannot name a
 * circle, so the pair has no spelling at all and the retype drops it rather than failing.
 */
function equalArcRadiusVersion(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
): Omit<SketchConstraintData, "id"> | undefined {
    const other = constraint.refs.find((ref) => ref.entityId !== id);
    if (other === undefined || solver.entity(other.entityId)?.type !== "arc") return undefined;
    return equalArcRadiusBetween(id, other.entityId);
}

/** The equal-radius relation over two arcs, in the refs `EqualArcRadius` is built from. */
export function equalArcRadiusBetween(first: number, second: number): Omit<SketchConstraintData, "id"> {
    return {
        kind: ConstraintKind.EqualArcRadius,
        refs: [centerRef(first), arcStartRef(first), centerRef(second), arcStartRef(second)],
    };
}

/** A tangency re-stated for the arc: the same pair of entities, one of them now an arc. */
function convertedTangent(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
): Omit<SketchConstraintData, "id"> | undefined {
    const ids = [...new Set(constraint.refs.map((ref) => ref.entityId))];
    if (ids.length !== 2 || !ids.includes(id)) return undefined;
    const typeOf = (entityId: number): SketchEntityType | undefined =>
        entityId === id ? "arc" : solver.entity(entityId)?.type;
    return tangentConstraintFor(typeOf(ids[0]), ids[0], typeOf(ids[1]), ids[1]);
}
