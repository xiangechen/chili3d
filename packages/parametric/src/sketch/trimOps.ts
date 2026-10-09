// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import { entityDomain, isClosedCurveType, isClosedEntity, isFreeCurveType, projectPoint } from "./curveEval";
import {
    type CurveCrossing,
    type CurvePiece,
    cutsOn,
    entityLength,
    farEnd,
    originEnd,
    parameterAt,
    pieceGeometry,
} from "./curveGeometry";
import {
    addFarHalf,
    circleToArcConstraint,
    dropBrokenConstraints,
    type EditOutcome,
    ellipseToArcConstraint,
    guardedEdit,
    migrateConstraints,
    pinCut,
    shortenCurveEntity,
    splitCurveEntity,
} from "./entityEditOps";
import { windowParameterAt } from "./offsetOps";
import type { SketchEntityData, SketchPointRef } from "./sketchModel";
import type { SketchSolver } from "./solver";

/**
 * The sketch trim: clicking a piece of an entity removes it. The piece is the span
 * between the two crossings nearest the click — one on each side — so what survives
 * is bounded by real geometry rather than by where the click happened to land. That
 * is the semantics Onshape, Fusion and FreeCAD all document, and the three shapes a
 * trim can take follow from applying it to each entity type: a span touching an end
 * shortens the entity, a span in the middle splits it in two, and a whole circle
 * becomes the arc the removed span leaves behind.
 *
 * The op is a plan and its application: the plan is pure geometry, the application is
 * direct solver mutation, and `guardedEdit` rolls the whole thing back on any failure —
 * the caller solves and commits afterwards. The geometry and the solver edits it shares
 * with the extend and the break live in `curveGeometry.ts` and `entityEditOps.ts`.
 */

/**
 * The two cuts bracketing the click, which bound the piece to remove. A missing side
 * is one of the entity's own ends — no cut there, so the piece runs to that end and
 * the entity is merely shortened. A circle has no ends, so for it both sides are
 * always cuts (the span wraps through the seam when the click sits before the first).
 */
interface RemovedSpan {
    from?: CurveCrossing;
    to?: CurveCrossing;
}

/** What a trim leaves behind (see `EditOutcome`). */
export type TrimOutcome = EditOutcome;

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
          readonly cut: CurveCrossing;
          readonly atOrigin: boolean;
      }
    | {
          readonly kind: "split";
          readonly entity: SketchEntityData;
          readonly from: CurveCrossing;
          readonly to: CurveCrossing;
      }
    | {
          readonly kind: "retype";
          readonly entity: SketchEntityData;
          readonly from: CurveCrossing;
          readonly to: CurveCrossing;
      };

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
    // the plan only reads the sketch, so a refusal needs no rollback — the guard is
    // opened around the mutation alone
    const plan = planTrim(solver, entityId, uv, tol);
    if (!plan.isOk) return Result.err(plan.error);
    return guardedEdit(solver, "the trim", () => applyPlan(solver, plan.value, tol));
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
): CurvePiece | undefined {
    const plan = planTrim(solver, entityId, uv, Math.max(tolerance, 1e-6));
    return plan.isOk ? planPiece(plan.value) : undefined;
}

/**
 * Whether the entity's *drawn* curve closes on itself. An offset copy has no closedness of its
 * own kind — it is a piece of the parallel curve of whatever it reads, and reads as closed
 * only while it runs over the whole of a closed source (`isClosedEntity`).
 */
function closedCurve(entity: SketchEntityData): boolean {
    return entity.type === "offsetCurve" ? isClosedEntity(entity) : isClosedCurveType(entity.type);
}

/** A crossing at the entity's own end bounds no piece: it is where the entity stops. */
function atOwnEnd(entity: SketchEntityData, cut: CurveCrossing, length: number, tolerance: number): boolean {
    if (closedCurve(entity)) return false;
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
    // The datum, the external references and an array's instances are reference geometry:
    // they cut, but they are never cut up. An offset copy is the exception — the solver does
    // place it, but it is the user's own curve, and the copy's window is exactly what a trim
    // is written to (see `trimOffsetCopy`).
    if (solver.isFixed(entityId) && entity.type !== "offsetCurve") {
        return Result.err("The datum and external references cannot be trimmed");
    }
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
 * at all when the entity has none, or a closed curve has only one — and that is the case
 * all three CAD systems resolve by removing the whole curve rather than refusing
 * (FreeCAD's delGeometry, Fusion "deletes the original"). A closed curve also wraps, so
 * its piece is measured round the seam rather than as a difference of its two parameters.
 */
function removedLength(
    entity: SketchEntityData,
    span: RemovedSpan,
    cuts: readonly CurveCrossing[],
    length: number,
): number {
    if (cuts.length === 0 || (closedCurve(entity) && cuts.length < 2)) return length;
    if (closedCurve(entity)) return wrappedSpan(span, length);
    return (span.to?.s ?? length) - (span.from?.s ?? 0);
}

/**
 * The plan for a piece that is neither the whole curve nor too short to be one: a
 * closed curve becomes the open one keeping its complement (a circle the arc, an
 * ellipse the ellipseArc), a piece at one of the entity's ends shortens it, and one in
 * the middle splits it. `undefined` for a span that bounds no such piece — the caller
 * has already ruled out the two ends of that range.
 */
function boundedPlan(entity: SketchEntityData, span: RemovedSpan): TrimPlan | undefined {
    const { from, to } = span;
    // a closed curve has no ends, so its span is always bounded by two cuts
    if (closedCurve(entity)) {
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
function planPiece(plan: TrimPlan): CurvePiece {
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
            // a closed curve's removed span wraps through the seam: its arc-length is
            // not simply the difference of the two parameters
            return pieceGeometry(entity, plan.from.s, wrappedSpan(plan, length));
    }
}

// ------------------------------------------------------------------ Applying the trim

/** Carries out a plan. */
function applyPlan(solver: SketchSolver, plan: TrimPlan, tolerance: number): Result<TrimOutcome> {
    // An offset copy is cut the same three ways and written a fourth: every one of them is a
    // *window* on the source it reads, since the copy has no point for the moves below to take
    // hold of (see `trimOffsetCopy`).
    if (plan.kind !== "delete" && plan.entity.type === "offsetCurve") {
        return trimOffsetCopy(solver, plan);
    }
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
            return plan.entity.type === "circle"
                ? circleToArc(solver, plan.entity, plan.from, plan.to, tolerance)
                : ellipseToArc(solver, plan.entity, plan.from, plan.to, tolerance);
    }
}

/**
 * Carries out a plan on an offset copy, as a window on the source it reads.
 *
 * All three of a trim's shapes come out the same way they do on any other curve — a piece at
 * an end shortens the copy, a piece in the middle splits it in two, and a whole closed copy
 * keeps the complement of the removed span — but each is written as the *parameter range* the
 * copy is then drawn over rather than by moving a point, because there is no point to move:
 * a copy is only the parallel curve of what it reads, so where it stops is a number on the
 * pair (`OffsetCurveRef.window`) and nothing else.
 *
 * The cuts are read into that parameter by projecting them onto the copy
 * (`offsetOps.windowParameterAt`), which is exact — the one measurement in the trim that has to
 * be, since no constraint can pin a copy's end to the cutter the way it pins a real curve's.
 */
function trimOffsetCopy(
    solver: SketchSolver,
    plan: Exclude<TrimPlan, { kind: "delete" }>,
): Result<TrimOutcome> {
    const copy = plan.entity;
    const ref = solver.offsetRefOf(copy.id);
    if (ref === undefined) return Result.err("Not an offset curve");
    const [start, end] = entityDomain(copy);
    if (plan.kind === "shorten") {
        const at = windowParameterAt(copy, plan.cut.point);
        const window: [number, number] = plan.atOrigin ? [at, end] : [start, at];
        return setCopyWindow(solver, copy.id, window);
    }
    const from = windowParameterAt(copy, plan.from.point);
    const to = windowParameterAt(copy, plan.to.point);
    if (plan.kind === "retype") {
        // a closed copy loses the removed span and keeps the rest, which runs forward from the
        // span's far bound to its near one — round the source's seam when that bound sits
        // after it, which is the one window a turn long rather than a piece of one
        const keptEnd = from > to ? from : from + (end - start);
        return setCopyWindow(solver, copy.id, [to, keptEnd]);
    }
    const kept = setCopyWindow(solver, copy.id, [start, from]);
    if (!kept.isOk) return kept;
    const newId = solver.addEntityFromParams("offsetCurve", [], undefined, {
        sourceId: ref.sourceId,
        sourceType: ref.sourceType,
        distance: ref.distance,
        window: [to, end],
    });
    if (solver.isConstruction(copy.id)) solver.setConstruction(newId, true);
    return Result.ok({ entityIds: [copy.id, newId], removedConstraints: [], deletedEntities: [] });
}

/** Writes one window onto a copy, as the outcome a trim reports. */
function setCopyWindow(
    solver: SketchSolver,
    entityId: number,
    window: [number, number],
): Result<TrimOutcome> {
    const written = solver.setOffsetWindow(entityId, window);
    if (!written.isOk) return Result.err(written.error);
    return Result.ok({ entityIds: [entityId], removedConstraints: [], deletedEntities: [] });
}

/**
 * Trims the piece running from `cut` to one of the entity's own ends: that end moves
 * to the cut. The entity keeps its id and its other end, so only the constraints
 * reading the moved point can be affected.
 */
function shorten(
    solver: SketchSolver,
    entity: SketchEntityData,
    cut: CurveCrossing,
    atOrigin: boolean,
    tolerance: number,
): Result<TrimOutcome> {
    // A free curve cannot move one end and keep its shape: what is left is the *same curve*
    // shortened, which is a different control-point set (`shortenCurveEntity`), exactly as
    // it is for the middle span of a `split`.
    if (isFreeCurveType(entity.type)) {
        const reshaped = shortenCurveEntity(solver, entity, projectPoint(entity, cut.point).t, atOrigin);
        if (!reshaped.isOk) return Result.err(reshaped.error);
        const kept = solver.entity(entity.id);
        if (kept === undefined) return Result.err("Unknown sketch entity");
        // the cut end is the piece's own: the reshape renumbers what it left
        pinCut(solver, atOrigin ? originEnd(kept) : farEnd(kept), cut, tolerance);
        return Result.ok({ entityIds: [entity.id], removedConstraints: reshaped.value, deletedEntities: [] });
    }
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
 *
 * The free curves cannot move one end and keep their shape: their kept half is the
 * *same curve* shortened, which is a different control-point set (`splitCurveEntity`
 * reparametrizes it, and moves the far end's constraints onto the new half itself), and
 * their far half likewise. A NURBS piece is reshaped rather than reparametrized, which is
 * the one way a split loses constraints — the ones reading control points the kept piece no
 * longer has, whose ids come back to be reported.
 */
function split(
    solver: SketchSolver,
    entity: SketchEntityData,
    from: CurveCrossing,
    to: CurveCrossing,
    tolerance: number,
): Result<TrimOutcome> {
    const far = farEnd(entity);
    const carved = carveFarHalf(solver, entity, from, to, far);
    if (!carved.isOk) return Result.err(carved.error);
    // Each half's fresh end is the crossing the trim made there: the kept half's far end,
    // and the new half's — its own start. Both are read off the *kept* entity: a free
    // curve's split re-makes its control-point list, so the far end the entity had before
    // is not the point that now sits at the cut (and on a reshaped NURBS it may not exist).
    const kept = solver.entity(entity.id);
    if (kept === undefined) return Result.err("Unknown sketch entity");
    pinCut(solver, farEnd(kept), from, tolerance);
    pinCut(solver, { entityId: carved.value.newId, pointIndex: originEnd(kept).pointIndex }, to, tolerance);
    return Result.ok({
        entityIds: [entity.id, carved.value.newId],
        removedConstraints: carved.value.dropped,
        deletedEntities: [],
    });
}

/**
 * Cuts the far half off, by whichever of the two strategies the entity's type calls for, and
 * reports the new entity's id along with the constraints the cut lost.
 */
function carveFarHalf(
    solver: SketchSolver,
    entity: SketchEntityData,
    from: CurveCrossing,
    to: CurveCrossing,
    far: SketchPointRef,
): Result<{ newId: number; dropped: number[] }> {
    const farPoint = solver.pointOf(far);
    if (isFreeCurveType(entity.type)) {
        const carved = splitCurveEntity(
            solver,
            entity,
            projectPoint(entity, from.point).t,
            projectPoint(entity, to.point).t,
        );
        if (!carved.isOk) return Result.err(carved.error);
        return Result.ok({ newId: carved.value.newId, dropped: carved.value.dropped });
    }
    solver.setPointPosition(far, from.point[0], from.point[1]);
    const newId = addFarHalf(solver, entity, to.point, farPoint);
    migrateConstraints(solver, entity, far, newId);
    return Result.ok({ newId, dropped: [] });
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
    from: CurveCrossing,
    to: CurveCrossing,
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

/**
 * Trims an ellipse into the ellipseArc its removed span leaves behind — the circle's
 * own retype one frame richer: the centre and both axis points survive (the arc layout
 * opens with them), so the relations reading the frame carry over as they are and only
 * the two rim points are new.
 */
function ellipseToArc(
    solver: SketchSolver,
    entity: SketchEntityData,
    from: CurveCrossing,
    to: CurveCrossing,
    tolerance: number,
): Result<TrimOutcome> {
    // the kept arc runs counter-clockwise from the far bound of the removed span round
    // to its near bound: the complement of what was removed
    const retyped = solver.retypeEntity(
        entity.id,
        "ellipseArc",
        [...entity.params.slice(0, 6), to.point[0], to.point[1], from.point[0], from.point[1]],
        (constraint) => ellipseToArcConstraint(solver, constraint, entity.id),
    );
    if (!retyped.isOk) return Result.err(retyped.error);
    pinCut(solver, { entityId: entity.id, pointIndex: 3 }, to, tolerance);
    pinCut(solver, { entityId: entity.id, pointIndex: 4 }, from, tolerance);
    return Result.ok({
        entityIds: [entity.id],
        removedConstraints: retyped.value,
        deletedEntities: [],
    });
}

// ------------------------------------------------------------------ Positions along an entity

/**
 * The two cuts the click sits between, or the entity's own end where there is none.
 * A closed curve wraps, so when there is no cut on one side of the click, that side is
 * the cut across the seam.
 */
function spanAround(entity: SketchEntityData, cuts: CurveCrossing[], click: number): RemovedSpan {
    const before = cuts.filter((cut) => cut.s < click).at(-1);
    const after = cuts.find((cut) => cut.s > click);
    if (!closedCurve(entity)) {
        return {
            ...(before === undefined ? {} : { from: before }),
            ...(after === undefined ? {} : { to: after }),
        };
    }
    return { from: before ?? cuts.at(-1), to: after ?? cuts[0] };
}

/** The arc-length the removed span covers on a closed curve, wrapping through the seam. */
function wrappedSpan(span: RemovedSpan, length: number): number {
    const from = span.from?.s ?? 0;
    const to = span.to?.s ?? 0;
    return (((to - from) % length) + length) % length;
}
