// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
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
    guardedEdit,
    migrateConstraints,
    pinCut,
} from "./entityEditOps";
import type { SketchEntityData } from "./sketchModel";
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

/** A crossing at the entity's own end bounds no piece: it is where the entity stops. */
function atOwnEnd(entity: SketchEntityData, cut: CurveCrossing, length: number, tolerance: number): boolean {
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
    cuts: readonly CurveCrossing[],
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
    cut: CurveCrossing,
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
    from: CurveCrossing,
    to: CurveCrossing,
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

// ------------------------------------------------------------------ Positions along an entity

/**
 * The two cuts the click sits between, or the entity's own end where there is none.
 * A circle wraps, so when there is no cut on one side of the click, that side is the
 * cut across the seam.
 */
function spanAround(entity: SketchEntityData, cuts: CurveCrossing[], click: number): RemovedSpan {
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

/** The arc-length the removed span covers on a circle, wrapping through the seam. */
function wrappedSpan(span: RemovedSpan, length: number): number {
    const from = span.from?.s ?? 0;
    const to = span.to?.s ?? 0;
    return (((to - from) % length) + length) % length;
}
