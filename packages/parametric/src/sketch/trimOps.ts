// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import {
    arcAngles,
    ConstraintKind,
    datumEntityData,
    isDatumEntityId,
    isStructuralConstraint,
    pointRefKey,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver, SolveOutcome } from "./solver";
import { arcStartRef, centerRef, lineRefs, tangentConstraintFor } from "./solverEntities";

/**
 * The sketch trim: clicking a piece of an entity removes it. The piece is the span
 * between the two crossings nearest the click — one on each side — so what survives
 * is bounded by real geometry rather than by where the click happened to land. That
 * is the semantics Onshape, Fusion and FreeCAD all document, and the three shapes a
 * trim can take follow from applying it to each entity type: a span touching an end
 * shortens the entity, a span in the middle splits it in two, and a whole circle
 * becomes the arc the removed span leaves behind.
 *
 * The op mirrors `cornerOps.ts`: pure geometry plus direct solver mutation, all of
 * it rolled back on any failure, with the caller solving and committing afterwards.
 */

/** One crossing of the trimmed entity with another entity, as a position along it. */
interface TrimCut {
    /** Sketch (u, v) of the crossing. */
    point: [number, number];
    /** Distance from the entity's origin along the entity — see `parameterAt`. */
    s: number;
    /** What crosses here: the new endpoint is pinned onto it. */
    cutter: SketchEntityData;
}

/**
 * The two cuts bracketing the click, which bound the piece to remove. A missing side
 * is one of the entity's own ends — no cut there, so the piece runs to that end and
 * the entity is merely shortened. A circle has no ends, so for it both sides are
 * always cuts (the span wraps through the seam when the click sits before the first).
 */
interface RemovedSpan {
    from?: TrimCut;
    to?: TrimCut;
}

/**
 * The piece a trim would remove, in the two shapes a sketch entity is drawn in. The
 * preview hands this to the editor, which knows how to mesh it; keeping the piece in
 * sketch terms is what lets the preview and the op agree on it without either
 * knowing about meshes.
 */
export type TrimPiece =
    | { readonly kind: "line"; readonly point1: [number, number]; readonly point2: [number, number] }
    | {
          readonly kind: "arc";
          readonly center: [number, number];
          readonly radius: number;
          /** Radians, counter-clockwise, from `startAngle`. */
          readonly startAngle: number;
          readonly sweep: number;
      };

/**
 * What a trim under a point would do. Deciding it is one step both callers need — the
 * op to carry it out, the preview to draw it — so the decision lives here once and
 * cannot drift between them.
 */
type TrimPlan =
    | { readonly kind: "delete"; readonly entity: SketchEntityData }
    | {
          readonly kind: "shorten";
          readonly entity: SketchEntityData;
          readonly cut: TrimCut;
          readonly atOrigin: boolean;
      }
    | {
          readonly kind: "split";
          readonly entity: SketchEntityData;
          readonly from: TrimCut;
          readonly to: TrimCut;
      }
    | {
          readonly kind: "retype";
          readonly entity: SketchEntityData;
          readonly from: TrimCut;
          readonly to: TrimCut;
      };

export interface TrimOutcome {
    /** Entities the trim left in place: the picked one, plus a split's new half. */
    entityIds: number[];
    /** Constraint ids the trim removed — their dimension anchors are orphans now. */
    removedConstraints: number[];
    /** Entity ids the trim deleted outright: nothing of the picked entity was left. */
    deletedEntities: number[];
}

/**
 * Removes the piece of `entityId` under `uv`. `tolerance` is in sketch units and
 * decides what counts as lying on a curve, so a crossing that only just reaches a
 * cutter's own end (a T-junction) still bounds the trim — the caller passes its
 * screen tolerance, floored, as the corner commands do.
 */
export function trimEntity(
    solver: SketchSolver,
    entityId: number,
    uv: [number, number],
    tolerance: number,
): Result<TrimOutcome> {
    const tol = Math.max(tolerance, 1e-6);
    // A sketch whose constraints already conflict is not this op's doing, so only a
    // solve the trim itself broke is worth rolling back.
    const baseline = solver.solve(true).result;
    const snapshot = solver.toData();
    const plan = planTrim(solver, entityId, uv, tol);
    if (!plan.isOk) return Result.err(plan.error);

    const outcome = applyPlan(solver, plan.value, tol);
    if (!outcome.isOk) {
        solver.reset(snapshot);
        return Result.err(outcome.error);
    }
    const solved = solver.solve(true);
    if (isBroken(solved.result) && !isBroken(baseline)) {
        solver.reset(snapshot);
        return Result.err(`The sketch could not solve after the trim (${solved.result})`);
    }
    return outcome;
}

/**
 * The piece a trim under `uv` would remove, or undefined when the trim would refuse
 * there — nothing crosses the entity, the click sits on a crossing, the piece is
 * shorter than the tolerance. The editor draws this under the cursor while the trim
 * pick is up, so what the click takes away is visible before it is taken.
 */
export function trimPreview(
    solver: SketchSolver,
    entityId: number,
    uv: [number, number],
    tolerance: number,
): TrimPiece | undefined {
    const plan = planTrim(solver, entityId, uv, Math.max(tolerance, 1e-6));
    return plan.isOk ? planPiece(plan.value) : undefined;
}

/** Whether a solve result is a failure the op has to answer for, rather than a warning. */
function isBroken(result: SolveOutcome["result"]): boolean {
    return result === "Conflicting" || result === "Diverged" || result === "Stalled";
}

/** A crossing at the entity's own end bounds no piece: it is where the entity stops. */
function atOwnEnd(entity: SketchEntityData, cut: TrimCut, length: number, tolerance: number): boolean {
    if (entity.type === "circle") return false;
    return cut.s <= tolerance || cut.s >= length - tolerance;
}

// ------------------------------------------------------------------ Deciding the trim

/**
 * What the trim under `uv` would do, worked out without touching the solver. The
 * tolerance is floored here rather than by the callers: the click arrives from a
 * screen pick, so nothing below may mistake that slack for real extent.
 */
function planTrim(
    solver: SketchSolver,
    entityId: number,
    uv: [number, number],
    tolerance: number,
): Result<TrimPlan> {
    const entity = solver.entity(entityId);
    if (entity === undefined) return Result.err("Unknown sketch entity");
    // the datum and the external references are reference geometry: they cut, but
    // they are never cut up
    if (solver.isFixed(entityId)) return Result.err("The datum and external references cannot be trimmed");
    const tol = Math.max(tolerance, 1e-6);

    const length = entityLength(entity);
    const cuts = cutsOn(solver, entity, tol).filter((cut) => !atOwnEnd(entity, cut, length, tol));
    const click = parameterAt(entity, uv);
    if (cuts.some((cut) => Math.abs(cut.s - click) <= tol)) {
        return Result.err("Pick the piece to remove, not a crossing");
    }
    const span = spanAround(entity, cuts, click);
    const removed = removedLength(entity, span, cuts, length);
    if (removed <= tol) return Result.err("There is no piece to remove there");
    if (removed >= length - tol) return Result.ok({ kind: "delete", entity });

    const plan = boundedPlan(entity, span);
    if (plan === undefined) return Result.err("There is no piece to remove there");
    return Result.ok(plan);
}

/**
 * How much of the entity the piece under the click takes. No crossing bounds a piece
 * at all when the entity has none, or a circle has only one — and that is the case all
 * three CAD systems resolve by removing the whole curve rather than refusing
 * (FreeCAD's delGeometry, Fusion "deletes the original"). A circle also wraps, so its
 * piece is measured round the seam rather than as a difference of its two parameters.
 */
function removedLength(
    entity: SketchEntityData,
    span: RemovedSpan,
    cuts: readonly TrimCut[],
    length: number,
): number {
    if (cuts.length === 0 || (entity.type === "circle" && cuts.length < 2)) return length;
    if (entity.type === "circle") return wrappedSpan(span, length);
    return (span.to?.s ?? length) - (span.from?.s ?? 0);
}

/**
 * The plan for a piece that is neither the whole curve nor too short to be one: a
 * circle becomes the arc keeping its complement, a piece at one of the entity's ends
 * shortens it, and one in the middle splits it. `undefined` for a span that bounds no
 * such piece — the caller has already ruled out the two ends of that range.
 */
function boundedPlan(entity: SketchEntityData, span: RemovedSpan): TrimPlan | undefined {
    const { from, to } = span;
    // a circle has no ends, so its span is always bounded by two cuts
    if (entity.type === "circle") {
        return from !== undefined && to !== undefined ? { kind: "retype", entity, from, to } : undefined;
    }
    // one cut and one end: the piece runs from the end to the cut, and the end moves
    if (from === undefined && to !== undefined) return { kind: "shorten", entity, cut: to, atOrigin: true };
    if (to === undefined && from !== undefined)
        return { kind: "shorten", entity, cut: from, atOrigin: false };
    if (from !== undefined && to !== undefined) return { kind: "split", entity, from, to };
    return undefined;
}

/** The piece a plan removes, as the editor draws it. */
function planPiece(plan: TrimPlan): TrimPiece {
    const { entity } = plan;
    const length = entityLength(entity);
    switch (plan.kind) {
        case "delete":
            return pieceGeometry(entity, 0, length);
        case "shorten":
            return plan.atOrigin
                ? pieceGeometry(entity, 0, plan.cut.s)
                : pieceGeometry(entity, plan.cut.s, length - plan.cut.s);
        case "split":
            return pieceGeometry(entity, plan.from.s, plan.to.s - plan.from.s);
        case "retype":
            // a circle's removed span wraps through the seam: its arc-length is not
            // simply the difference of the two parameters
            return pieceGeometry(entity, plan.from.s, wrappedSpan(plan, length));
    }
}

// ------------------------------------------------------------------ Applying the trim

/** Carries out a plan. */
function applyPlan(solver: SketchSolver, plan: TrimPlan, tolerance: number): Result<TrimOutcome> {
    switch (plan.kind) {
        case "delete":
            return Result.ok({
                entityIds: [],
                removedConstraints: solver.removeEntity(plan.entity.id),
                deletedEntities: [plan.entity.id],
            });
        case "shorten":
            return shorten(solver, plan.entity, plan.cut, plan.atOrigin, tolerance);
        case "split":
            return split(solver, plan.entity, plan.from, plan.to, tolerance);
        case "retype":
            return circleToArc(solver, plan.entity, plan.from, plan.to, tolerance);
    }
}

/**
 * Trims the piece running from `cut` to one of the entity's own ends: that end moves
 * to the cut. The entity keeps its id and its other end, so only the constraints
 * reading the moved point can be affected.
 */
function shorten(
    solver: SketchSolver,
    entity: SketchEntityData,
    cut: TrimCut,
    atOrigin: boolean,
    tolerance: number,
): Result<TrimOutcome> {
    const ref = atOrigin ? originEnd(entity) : farEnd(entity);
    const removedConstraints = dropBrokenConstraints(solver, ref);
    solver.setPointPosition(ref, cut.point[0], cut.point[1]);
    pinCut(solver, ref, cut, tolerance);
    return Result.ok({ entityIds: [entity.id], removedConstraints, deletedEntities: [] });
}

/**
 * Trims a piece out of the middle: the entity is cut back to the near bound, and the
 * far half is added as a new entity. The half holding the entity's origin keeps the
 * id — the same choice FreeCAD makes, and the reason the constraints that migrate are
 * only the ones hung off the far end.
 */
function split(
    solver: SketchSolver,
    entity: SketchEntityData,
    from: TrimCut,
    to: TrimCut,
    tolerance: number,
): Result<TrimOutcome> {
    const far = farEnd(entity);
    const farPoint = solver.pointOf(far);
    solver.setPointPosition(far, from.point[0], from.point[1]);

    const newId = addFarHalf(solver, entity, to.point, farPoint);
    migrateConstraints(solver, entity, far, newId);
    // each half's fresh end is the crossing the trim made there: the kept half's far
    // end, and the new half's — its own start, not the index the far end had
    pinCut(solver, far, from, tolerance);
    pinCut(solver, { entityId: newId, pointIndex: originEnd(entity).pointIndex }, to, tolerance);
    // nothing is dropped: every constraint either follows the far point onto the new half
    // or is re-stated per half, and both keep their id — so every anchor stays put
    return Result.ok({ entityIds: [entity.id, newId], removedConstraints: [], deletedEntities: [] });
}

/**
 * The far half as an entity of its own, from the trim's far crossing to the end the
 * original had. It inherits everything the half is rather than just its shape: the
 * construction flag, and for an arc the shared centre — without that the second arc's
 * radius is an independent unknown and the pieces drift apart under a drag.
 */
function addFarHalf(
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
 * Trims a circle into the arc its removed span leaves behind. The centre point and
 * the id survive — only the radius param goes — so the entity is retyped rather than
 * replaced, and each constraint is converted by `circleToArcConstraint`, the kinds an
 * arc cannot express being reported as dropped.
 */
function circleToArc(
    solver: SketchSolver,
    entity: SketchEntityData,
    from: TrimCut,
    to: TrimCut,
    tolerance: number,
): Result<TrimOutcome> {
    // the kept arc runs counter-clockwise from the far bound of the removed span round
    // to its near bound: the complement of what was removed
    const retyped = solver.retypeEntity(
        entity.id,
        "arc",
        [entity.params[0], entity.params[1], to.point[0], to.point[1], from.point[0], from.point[1]],
        (constraint) => circleToArcConstraint(solver, constraint, entity.id),
    );
    if (!retyped.isOk) return Result.err(retyped.error);
    pinCut(solver, { entityId: entity.id, pointIndex: 1 }, to, tolerance);
    pinCut(solver, { entityId: entity.id, pointIndex: 2 }, from, tolerance);
    return Result.ok({
        entityIds: [entity.id],
        removedConstraints: retyped.value,
        deletedEntities: [],
    });
}

/** The point ref the entity's origin end sits at: a line's start, an arc's start. */
function originEnd(entity: SketchEntityData): SketchPointRef {
    return { entityId: entity.id, pointIndex: entity.type === "line" ? 0 : 1 };
}

/** The point ref at the other end: a line's end, an arc's end. */
function farEnd(entity: SketchEntityData): SketchPointRef {
    return { entityId: entity.id, pointIndex: entity.type === "line" ? 1 : 2 };
}

// ------------------------------------------------------------------ Endpoints the trim creates

/**
 * Attaches a freshly created or moved endpoint to the entity that cut it, so the two
 * stay together when either is edited later. A cut landing on the cutter's own end is
 * common enough (a T-junction) that the incidence becomes a coincidence there — the
 * same point-to-point / point-to-object choice `autoConstraints` makes when a drawn
 * point snaps onto geometry, and the one FreeCAD's trim documents.
 */
function pinCut(solver: SketchSolver, ref: SketchPointRef, cut: TrimCut, tolerance: number): void {
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
 * Drops the constraints a shortened entity can no longer honour: those reading the
 * endpoint that moved, except the ones an extent or a radius protects (see
 * `survivesSlide`) and the entity's own structural constraint, which is part of the
 * entity rather than a user constraint. Returns the removed ids so the caller can
 * report them and prune their dimension anchors.
 */
function dropBrokenConstraints(solver: SketchSolver, movedRef: SketchPointRef): number[] {
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

/**
 * Moves a split entity's constraints onto the halves that now hold their points. Only
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
function migrateConstraints(
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
        ...(constraint.datum === undefined ? {} : { datum: constraint.datum }),
        ...(constraint.datums === undefined ? {} : { datums: constraint.datums }),
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
 * circle has no arc form, so the trim drops it rather than failing.
 *
 * A radius reading (Ø or R) is carried as the user wrote it: the retype moves the
 * geometry, and an annotation is not geometry. An arc dimensioned from scratch reads R
 * (`buildRadiusReading`), but a dimension already placed keeps the reading it was given.
 * A driven dimension is carried for the same reason — it is a measurement the user asked
 * for, and dropping the flag here would quietly turn it into one that holds the arc.
 */
function circleToArcConstraint(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
): Omit<SketchConstraintData, "id"> | undefined {
    const carried = {
        kind: constraint.kind,
        refs: constraint.refs,
        ...(constraint.datum === undefined ? {} : { datum: constraint.datum }),
        ...(constraint.datums === undefined ? {} : { datums: constraint.datums }),
        ...(constraint.display === undefined ? {} : { display: constraint.display }),
        ...(constraint.driven === true ? { driven: true } : {}),
    };
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
 * circle, so the pair has no spelling at all and the trim drops it rather than failing.
 */
function equalArcRadiusVersion(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
): Omit<SketchConstraintData, "id"> | undefined {
    const other = constraint.refs.find((ref) => ref.entityId !== id);
    if (other === undefined || solver.entity(other.entityId)?.type !== "arc") return undefined;
    return {
        kind: ConstraintKind.EqualArcRadius,
        refs: [centerRef(id), arcStartRef(id), centerRef(other.entityId), arcStartRef(other.entityId)],
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

// ------------------------------------------------------------------ Positions along an entity

/** Length `s` runs over: a line's length, an arc's swept length, a circle's circumference. */
function entityLength(entity: SketchEntityData): number {
    if (entity.type === "line") {
        return Math.hypot(entity.params[2] - entity.params[0], entity.params[3] - entity.params[1]);
    }
    const radius = entityRadiusOf(entity);
    return entity.type === "circle" ? Math.PI * 2 * radius : arcAngles(entity.params)[1] * radius;
}

/**
 * Where `point` sits along the entity, as a distance from its origin — a line's start
 * point, an arc's start point, a circle's zero angle. One scalar for all three, so
 * the piece between two cuts is an interval and "shorter than the tolerance" means
 * the same thing everywhere.
 */
function parameterAt(entity: SketchEntityData, point: [number, number]): number {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        const length = entityLength(entity);
        if (length < 1e-12) return 0;
        return ((point[0] - x1) * (x2 - x1) + (point[1] - y1) * (y2 - y1)) / length;
    }
    const [cx, cy] = entity.params;
    const from = entity.type === "circle" ? 0 : arcAngles(entity.params)[0];
    const angle = Math.atan2(point[1] - cy, point[0] - cx);
    return normalizeAngle(angle - from) * entityRadiusOf(entity);
}

/** The circle an entity lies on: a circle's own, an arc's from centre to start. */
function entityRadiusOf(entity: SketchEntityData): number {
    if (entity.type === "circle") return entity.params[2];
    return Math.hypot(entity.params[2] - entity.params[0], entity.params[3] - entity.params[1]);
}

/**
 * The piece of an entity between two positions along it, in the terms the editor draws
 * entities in — a straight segment for a line, an arc of the entity's own circle
 * otherwise. `start` and `arcLength` are the arclength `parameterAt` speaks, so the
 * angle falls out of the radius without either caller going near one.
 */
function pieceGeometry(entity: SketchEntityData, start: number, arcLength: number): TrimPiece {
    if (entity.type === "line") {
        return { kind: "line", point1: pointAt(entity, start), point2: pointAt(entity, start + arcLength) };
    }
    const radius = entityRadiusOf(entity);
    return {
        kind: "arc",
        center: [entity.params[0], entity.params[1]],
        radius,
        startAngle: originAngle(entity) + start / radius,
        sweep: arcLength / radius,
    };
}

/** The sketch (u, v) one distance `s` along the entity, from the same origin `parameterAt` measures. */
function pointAt(entity: SketchEntityData, s: number): [number, number] {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        const length = entityLength(entity);
        const t = length < 1e-12 ? 0 : s / length;
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    const [cx, cy] = entity.params;
    const radius = entityRadiusOf(entity);
    const angle = originAngle(entity) + s / radius;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/** Where `s` counts from: a circle's zero angle, an arc's start ray. */
function originAngle(entity: SketchEntityData): number {
    return entity.type === "circle" ? 0 : arcAngles(entity.params)[0];
}

/** An angle folded into [0, 2π). */
function normalizeAngle(angle: number): number {
    const full = Math.PI * 2;
    return ((angle % full) + full) % full;
}

/** The arc-length the removed span covers on a circle, wrapping through the seam. */
function wrappedSpan(span: RemovedSpan, length: number): number {
    const from = span.from?.s ?? 0;
    const to = span.to?.s ?? 0;
    return (((to - from) % length) + length) % length;
}

// ------------------------------------------------------------------ Crossings

/** Every crossing of `entity` with the sketch's other geometry, in order along it. */
function cutsOn(solver: SketchSolver, entity: SketchEntityData, tolerance: number): TrimCut[] {
    const cuts: TrimCut[] = [];
    for (const cutter of cuttersFor(solver, entity)) {
        for (const point of intersectCurves(entity, cutter, tolerance)) {
            cuts.push({ point, s: parameterAt(entity, point), cutter });
        }
    }
    return collapseCuts(entity, cuts, tolerance);
}

/**
 * What can cut the entity: every other entity, the external references, and the datum
 * axes. The axes are read as the infinite lines the editor draws them as, so a line
 * crossing the X axis beyond the unit segment the datum is stored with is still cut
 * there.
 */
function cuttersFor(solver: SketchSolver, entity: SketchEntityData): SketchEntityData[] {
    return [
        ...solver.entities().filter((other) => other.id !== entity.id && !isDegenerate(other)),
        ...solver.externalEntitiesData().filter((other) => !isDegenerate(other)),
        datumEntityData(SKETCH_X_AXIS_ID),
        datumEntityData(SKETCH_Y_AXIS_ID),
    ];
}

/** An entity with no extent defines no crossing: a zero-length line, a point arc. */
function isDegenerate(entity: SketchEntityData): boolean {
    return entity.type === "line" ? entityLength(entity) < 1e-9 : entityRadiusOf(entity) < 1e-9;
}

/**
 * The cuts in order along the entity, coincident ones merged: two cutters meeting an
 * entity at the same point bound one piece, not two, and a tangency's double root is
 * one crossing. The first of a merged group keeps its cutter, which is the one the
 * new endpoint is pinned to.
 */
function collapseCuts(entity: SketchEntityData, cuts: TrimCut[], tolerance: number): TrimCut[] {
    const merged: TrimCut[] = [];
    for (const cut of [...cuts].sort((a, b) => a.s - b.s)) {
        const previous = merged.at(-1);
        if (previous !== undefined && cut.s - previous.s <= tolerance) continue;
        merged.push(cut);
    }
    // a circle's first and last cut can be one crossing either side of the seam
    if (entity.type === "circle" && merged.length > 1) {
        const seam = merged[0].s + entityLength(entity) - merged[merged.length - 1].s;
        if (seam <= tolerance) merged.pop();
    }
    return merged;
}

/**
 * The two cuts the click sits between, or the entity's own end where there is none.
 * A circle wraps, so when there is no cut on one side of the click, that side is the
 * cut across the seam.
 */
function spanAround(entity: SketchEntityData, cuts: TrimCut[], click: number): RemovedSpan {
    const before = cuts.filter((cut) => cut.s < click).at(-1);
    const after = cuts.find((cut) => cut.s > click);
    if (entity.type !== "circle") {
        return {
            ...(before === undefined ? {} : { from: before }),
            ...(after === undefined ? {} : { to: after }),
        };
    }
    return { from: before ?? cuts.at(-1), to: after ?? cuts[0] };
}

/** Every crossing of two entities, as sketch (u, v) points. */
function intersectCurves(a: SketchEntityData, b: SketchEntityData, tolerance: number): [number, number][] {
    const points: [number, number][] =
        a.type === "line" && b.type === "line"
            ? intersectLineLine(lineOf(a), lineOf(b))
            : a.type === "line"
              ? intersectLineCircle(lineOf(a), circleOf(b))
              : b.type === "line"
                ? intersectLineCircle(lineOf(b), circleOf(a))
                : intersectCircleCircle(circleOf(a), circleOf(b));
    return points.filter((point) => onEntity(a, point, tolerance) && onEntity(b, point, tolerance));
}

interface LineGeometry {
    origin: [number, number];
    direction: [number, number];
}

interface CircleGeometry {
    center: [number, number];
    radius: number;
}

function lineOf(entity: SketchEntityData): LineGeometry {
    const [x1, y1, x2, y2] = entity.params;
    return { origin: [x1, y1], direction: [x2 - x1, y2 - y1] };
}

function circleOf(entity: SketchEntityData): CircleGeometry {
    return { center: [entity.params[0], entity.params[1]], radius: entityRadiusOf(entity) };
}

/** Whether `point` lies on the entity, no further than `tolerance` off it. */
function onEntity(entity: SketchEntityData, point: [number, number], tolerance: number): boolean {
    // a datum axis is the infinite line it is drawn as
    if (isDatumEntityId(entity.id)) return true;
    if (entity.type === "line") return pointToSegmentDistance(point, lineOf(entity)) <= tolerance;
    const { center, radius } = circleOf(entity);
    const off = Math.hypot(point[0] - center[0], point[1] - center[1]);
    if (Math.abs(off - radius) > tolerance) return false;
    if (entity.type === "circle") return true;
    // on an arc the crossing must also fall inside its sweep — the same tolerance,
    // taken as an angle at that radius
    const [start, sweep] = arcAngles(entity.params);
    const offset = normalizeAngle(Math.atan2(point[1] - center[1], point[0] - center[0]) - start);
    return offset <= sweep + tolerance / radius || Math.PI * 2 - offset <= tolerance / radius;
}

function pointToSegmentDistance(point: [number, number], line: LineGeometry): number {
    const [dx, dy] = line.direction;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-18) {
        return Math.hypot(point[0] - line.origin[0], point[1] - line.origin[1]);
    }
    const t = Math.max(
        0,
        Math.min(1, ((point[0] - line.origin[0]) * dx + (point[1] - line.origin[1]) * dy) / lengthSquared),
    );
    return Math.hypot(point[0] - (line.origin[0] + t * dx), point[1] - (line.origin[1] + t * dy));
}

/**
 * The two infinite lines' crossing. Parallel lines have none — and neither do
 * collinear ones, deliberately: a cutter lying along the entity bounds no piece of
 * it, so it must not read as a run of crossings along its whole length.
 */
function intersectLineLine(a: LineGeometry, b: LineGeometry): [number, number][] {
    const [ax, ay] = a.direction;
    const [bx, by] = b.direction;
    const det = ax * by - ay * bx;
    if (Math.abs(det) <= 1e-9 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return [];
    const dx = b.origin[0] - a.origin[0];
    const dy = b.origin[1] - a.origin[1];
    const t = (dx * by - dy * bx) / det;
    return [[a.origin[0] + t * ax, a.origin[1] + t * ay]];
}

/** The line's crossing with the circle: two points, one when the line is tangent. */
function intersectLineCircle(line: LineGeometry, circle: CircleGeometry): [number, number][] {
    const [dx, dy] = line.direction;
    const fx = line.origin[0] - circle.center[0];
    const fy = line.origin[1] - circle.center[1];
    const a = dx * dx + dy * dy;
    if (a < 1e-18) return [];
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circle.radius * circle.radius;
    const discriminant = b * b - 4 * a * c;
    const epsilon = 1e-9 * (b * b + Math.abs(4 * a * c));
    if (discriminant < -epsilon) return [];
    // a tangent's double root is one crossing, and must not read as two cuts
    const roots =
        Math.abs(discriminant) <= epsilon
            ? [-b / (2 * a)]
            : [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
    return roots.map((t) => [line.origin[0] + t * dx, line.origin[1] + t * dy]);
}

/** The two circles' crossings, taken on the radical line; none when concentric or apart. */
function intersectCircleCircle(a: CircleGeometry, b: CircleGeometry): [number, number][] {
    const dx = b.center[0] - a.center[0];
    const dy = b.center[1] - a.center[1];
    const distance = Math.hypot(dx, dy);
    const epsilon = 1e-9 * Math.max(a.radius, b.radius, distance);
    if (distance <= epsilon) return [];
    if (distance > a.radius + b.radius + epsilon) return [];
    if (distance < Math.abs(a.radius - b.radius) - epsilon) return [];
    const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
    const halfSquared = a.radius * a.radius - along * along;
    const ux = dx / distance;
    const uy = dy / distance;
    const foot: [number, number] = [a.center[0] + along * ux, a.center[1] + along * uy];
    if (halfSquared <= epsilon * epsilon) return [foot];
    const offset = Math.sqrt(halfSquared);
    return [
        [foot[0] - offset * uy, foot[1] + offset * ux],
        [foot[0] + offset * uy, foot[1] - offset * ux],
    ];
}
