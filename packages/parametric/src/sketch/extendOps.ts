// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
import {
    curveControlPoints,
    ellipseParameterOf,
    ellipseSweep,
    entityDomain,
    entityPeriod,
    evaluateEntity,
    isClosedCurveType,
    isClosedEntity,
    isFreeCurveType,
    nurbsSpec,
    nurbsWeights,
    projectSupport,
    subBezier,
    subConic,
    subNurbs,
    supportArcLength,
} from "./curveEval";
import {
    type CurveCrossing,
    type CurvePiece,
    entityLength,
    entityRadiusOf,
    farEnd,
    originEnd,
    parameterAt,
    pieceGeometry,
    rawIntersections,
    supportParameterAt,
} from "./curveGeometry";
import { dropBrokenConstraints, type EditOutcome, guardedEdit, pinCut, reshapeCurve } from "./entityEditOps";
// the window reading the extend and the handles both take: where a point sits on the copy
import { windowParameterAt } from "./offsetOps";
import type { PreviewPiece } from "./previewTypes";
import type { NurbsSpec, SketchEntityData, SketchPointRef } from "./sketchModel";
import type { SketchSolver } from "./solver";

/**
 * The sketch extend: one end of the target moves along its own support curve until it
 * reaches the corner the two support curves share, and the new endpoint is pinned onto the
 * boundary — the same incidence a trim leaves behind, which is what keeps the two together
 * when either is edited later. Which end that is falls out of the corner (`endToMove`): the
 * end the corner lies beyond, or the one the click picked when the corner lies inside the
 * entity and only the click can say which end was meant.
 *
 * The boundary is picked separately rather than found by the click, which is what the
 * freeform `modify.extend` does and what a sketch needs: a target can have any number of
 * crossings out there, and only the user knows which one was meant. `modifyBoundary` brings
 * the boundary's own end to the corner as well, so "make these two meet" is one gesture.
 *
 * The op is a plan and its application, on `trimOps`' terms: the plan is pure geometry, the
 * application is direct solver mutation, and `guardedEdit` rolls the whole thing back on any
 * failure. The caller solves and commits afterwards.
 */

/** Which end of an entity a click aims at: the one nearer it. */
interface PickedEnd {
    readonly atOrigin: boolean;
    readonly ref: SketchPointRef;
}

/** One entity's part in the extend: where it was clicked, and the end of it that could move. */
interface CornerSide {
    readonly entity: SketchEntityData;
    readonly uv: [number, number];
    /** The end nearer the click; `undefined` for an entity with no ends at all. */
    readonly end: PickedEnd | undefined;
}

/** One end's move to the corner: where it lands, and the span the entity gains or gives up. */
interface EndMove {
    readonly entity: SketchEntityData;
    readonly ref: SketchPointRef;
    /** Which of the entity's two ends this is: a NURBS' reshape renumbers them. */
    readonly atOrigin: boolean;
    readonly crossing: CurveCrossing;
    readonly piece: PreviewPiece;
    /**
     * The free curves' remake: an end of a conic, bezier or NURBS cannot move without the
     * whole control-point set following (the curve it leaves must be the same one), so the
     * move carries the replacement — the conic's new rho, and for a NURBS its weights and
     * knots, since a piece of one is a control-point list of its own.
     */
    readonly replacement?: FreeCurveReplacement;
}

/**
 * What a plan asks for: the target's end moving to the corner, and — when the boundary is
 * moved with it — the boundary's. `piece` is what the entity gains, or gives up when the
 * corner lies inside it and the "extend" is really a cut back.
 */
interface EndMoves {
    readonly target: EndMove;
    readonly boundary?: EndMove;
}

export interface ExtendOptions {
    /** The entity to prolong: any open curve — a closed one has no end to move. */
    readonly targetId: number;
    /** Where on the target the user clicked: it decides which end moves. */
    readonly targetUv: [number, number];
    /** What the target runs out to: another entity, an external reference or a datum axis. */
    readonly boundaryId: number;
    /** Where on the boundary the user clicked, to choose between two crossings. */
    readonly boundaryUv: [number, number];
    /** Whether the boundary is brought to the corner too. */
    readonly modifyBoundary: boolean;
    /** Sketch units: what counts as reaching the corner. Never the least confirmable distance. */
    readonly tolerance: number;
}

/** What an extend leaves behind (see `EditOutcome`). */
export type ExtendOutcome = EditOutcome;

/**
 * Prolongs the target to the corner it shares with the boundary. The target's end nearer
 * `targetUv` is the one that moves; the boundary is picked separately and, with
 * `modifyBoundary`, moved to the corner too.
 */
export function extendEntity(solver: SketchSolver, options: ExtendOptions): Result<ExtendOutcome> {
    // floored once and handed to both halves: the plan and its application have to read
    // the same tolerance, or the pin can disagree with the move that earned it
    const tolerance = sketchTolerance(options.tolerance);
    // An offset copy has no point for a move to take hold of: its end is a *window* on the
    // source it reads, so it is planned and applied on its own terms (see `planCopyExtend`)
    if (solver.entity(options.targetId)?.type === "offsetCurve") {
        const copyPlan = planCopyExtend(solver, options, tolerance);
        if (!copyPlan.isOk) return Result.err(copyPlan.error);
        return guardedEdit(solver, "the extend", () => applyCopyExtend(solver, copyPlan.value, tolerance));
    }
    const plan = planExtend(solver, options, tolerance);
    if (!plan.isOk) return Result.err(plan.error);
    return guardedEdit(solver, "the extend", () => applyMoves(solver, plan.value, tolerance));
}

/**
 * The spans an extend under the same options would change, or `undefined` when it would
 * refuse there. The editor draws these under the cursor while the boundary pick is up, so
 * what the click will do is visible before it is done — and, since the plan is the very one
 * the op applies, the two cannot drift.
 */
export function extendPreview(solver: SketchSolver, options: ExtendOptions): PreviewPiece[] | undefined {
    const tolerance = sketchTolerance(options.tolerance);
    if (solver.entity(options.targetId)?.type === "offsetCurve") {
        const plan = planCopyExtend(solver, options, tolerance);
        return plan.isOk ? copyPreviewPieces(plan.value) : undefined;
    }
    const plan = planExtend(solver, options, tolerance);
    if (!plan.isOk) return undefined;
    return [plan.value.target.piece, ...(plan.value.boundary ? [plan.value.boundary.piece] : [])];
}

/**
 * What counts as reaching a corner. The click arrives from a screen pick, so its slack is
 * never allowed to stand in for real extent: a target shorter than the pick's own error
 * would otherwise read as reaching the corner it is nowhere near.
 */
function sketchTolerance(tolerance: number): number {
    return Math.max(tolerance, 1e-6);
}

/**
 * The target and the boundary an extend names, refused as a pair when it cannot take one: a
 * reference entity that is never cut, a target with no ends of its own, or an entity picked
 * as its own boundary.
 */
function extendPair(
    solver: SketchSolver,
    options: ExtendOptions,
): Result<{ target: SketchEntityData; boundary: SketchEntityData }> {
    const target = solver.entity(options.targetId);
    if (target === undefined) return Result.err("Unknown sketch entity");
    // the datum and the external references are reference geometry: they cut, but they
    // are never cut up
    if (solver.isFixed(target.id)) return Result.err("The datum and external references cannot be extended");
    if (isClosedCurveType(target.type)) {
        return Result.err(
            target.type === "circle" ? "A circle has no end to extend" : "An ellipse has no end to extend",
        );
    }
    const boundary = solver.entity(options.boundaryId);
    if (boundary === undefined) return Result.err("Unknown sketch entity");
    if (boundary.id === target.id) return Result.err("Pick a different entity for the boundary");
    return Result.ok({ target, boundary });
}

function planExtend(solver: SketchSolver, options: ExtendOptions, tol: number): Result<EndMoves> {
    const pair = extendPair(solver, options);
    if (!pair.isOk) return Result.err(pair.error);
    const { target, boundary } = pair.value;

    // a boundary with no ends of its own (a closed curve, a datum axis) is met but never moved
    const sides: CornerSide[] = [
        { entity: target, uv: options.targetUv, end: pickedEnd(target, options.targetUv) },
        {
            entity: boundary,
            uv: options.boundaryUv,
            end:
                options.modifyBoundary && !solver.isFixed(boundary.id)
                    ? pickedEnd(boundary, options.boundaryUv)
                    : undefined,
        },
    ];

    const corner = bestCorner(sides, tol);
    if (!corner.isOk) return Result.err(corner.error);

    const targetMove = moveOf(sides[0], boundary, corner.value, tol);
    if (!targetMove.isOk) return Result.err(targetMove.error);
    // the target has nothing to do if it already ends on the corner — that is the refusal,
    // where the boundary's own version of the same finding is what makes its move fall away
    if (targetMove.value === undefined) return Result.err("The entity already reaches the corner");
    if (sides[1].end === undefined) return Result.ok({ target: targetMove.value });
    // the boundary's move is the gesture's second half, never its point: one the boundary
    // has no way to make — a corner it already stands on, an end that would collapse it, an
    // arc that would close — falls away, exactly as a boundary with no end to move does, and
    // the target's own extension stands. The preview draws the plan, so which half is coming
    // is on screen before the click
    const boundaryMove = moveOf(sides[1], target, corner.value, tol);
    if (!boundaryMove.isOk || boundaryMove.value === undefined) {
        return Result.ok({ target: targetMove.value });
    }
    return Result.ok({ target: targetMove.value, boundary: boundaryMove.value });
}

/**
 * Where the two curves' supports meet, as the corner the target is prolonged to. A line
 * and a circle, or two circles, can meet twice; a candidate reached by *growing* the
 * picked ends is preferred over one reached by cutting them back, and the crossing
 * geometrically nearest the two clicks breaks the tie — the freeform extend's own rule,
 * and the reason a line crossing a circle extends to the crossing on the click's side of
 * it rather than through it.
 */
function bestCorner(sides: readonly CornerSide[], tolerance: number): Result<[number, number]> {
    const candidates = rawIntersections(sides[0].entity, sides[1].entity);
    if (candidates.length === 0) return Result.err("The two entities do not meet when extended");
    const missed = (point: [number, number]) =>
        sides.reduce((count, side) => count + (reachedOutward(side, point, tolerance) ? 0 : 1), 0);
    const cost = (point: [number, number]) =>
        sides.reduce((sum, side) => sum + Math.hypot(point[0] - side.uv[0], point[1] - side.uv[1]), 0);
    const sorted = [...candidates].sort((a, b) => missed(a) - missed(b) || cost(a) - cost(b));
    return Result.ok(sorted[0]);
}

/**
 * Whether `point` is where the picked end would be dragged *outward*: beyond it along the
 * support curve (which is where the corner of an extend lies, so the support's own
 * arclength is what measures it). A candidate inside the entity is one the end would have
 * to back into instead, which is what makes the ranking prefer the crossing the user was
 * pointing at.
 */
function reachedOutward(side: CornerSide, point: [number, number], tolerance: number): boolean {
    if (side.end === undefined) return false;
    const at = endParameter(side.entity, side.end.atOrigin, supportParameterAt(side.entity, point));
    return side.end.atOrigin ? at < -tolerance : at > entityLength(side.entity) + tolerance;
}

/** Which end of the entity a click at `uv` aims at: the nearer one. A closed curve has none. */
function pickedEnd(entity: SketchEntityData, uv: [number, number]): PickedEnd | undefined {
    if (isClosedCurveType(entity.type)) return undefined;
    return endFor(entity, parameterAt(entity, uv) <= entityLength(entity) / 2);
}

/** One of the entity's two ends, by which side of it is meant. */
function endFor(entity: SketchEntityData, atOrigin: boolean): PickedEnd {
    return { atOrigin, ref: atOrigin ? originEnd(entity) : farEnd(entity) };
}

/**
 * The end a corner moves: the one the corner lies *beyond*, or — when it lies inside the
 * entity, where either end could be the one meant — the one the click picked.
 *
 * That is the freeform extend's own rule (`bothEndsFreeRange`: a destination inside the
 * range is settled by the pick, one outside "grows the range to reach it"), and FreeCAD's
 * (`DrawSketchHandlerExtend` re-decides its end from the cursor unless the projection falls
 * on the curve, where the object pick stands). The destination decides an extension and the
 * object pick decides a cut back, which is what a sketch can express: the click is where the
 * user was looking, and it is not a statement about the far end of the line.
 *
 * An arc is the exception: every point of its circle is reachable from either of its ends,
 * so nothing but the click can say which was meant. The numeric open curves (ellipseArc,
 * conic, bezier) follow it: their support wraps or bends back on itself, so the click
 * decides there too.
 */
function endToMove(
    entity: SketchEntityData,
    picked: PickedEnd | undefined,
    point: [number, number],
): PickedEnd | undefined {
    if (picked === undefined || entity.type !== "line") return picked;
    const s = parameterAt(entity, point);
    if (s <= 0) return endFor(entity, true);
    if (s >= entityLength(entity)) return endFor(entity, false);
    return picked;
}

/**
 * Where a position sits measured from the origin end as a *signed* distance. A line's
 * is already signed; an open curve on a closed support (an arc, an ellipseArc) wraps
 * into [0, full turn), so an origin end dragged backwards has its corner behind the
 * seam and the wrap is undone before the extent is measured against it — which is why
 * `atOrigin` has to be asked for rather than assumed. The far end never needs the undo:
 * moving it outward stops short of the full turn (`moveOf` refuses the arc that would
 * close), and past the far end the raw wrap is the reading that says so.
 */
function endParameter(entity: SketchEntityData, atOrigin: boolean, s: number): number {
    if ((entity.type !== "arc" && entity.type !== "ellipseArc") || !atOrigin) return s;
    return s <= entityLength(entity) ? s : s - supportArcLength(entity);
}

/**
 * Whether the corner sits on one of the entity's own ends — either end, not just the one
 * the click picked. The entity reaches the corner either way, so nothing has to move.
 * Asking the picked end alone gets the arc wrong: its two ends lie on the same circle and
 * `endToMove` never re-decides it, so a click near one end and a corner on the other reads
 * as a move that swallows the whole arc.
 *
 * The numeric families read the corner on the *support* rather than the drawn span: a
 * clamped projection lands every past-the-end corner exactly on the end, and a collinear
 * bezier's outward extension would read as already reaching the corner it has not reached.
 */
function onAnEnd(entity: SketchEntityData, point: [number, number], tolerance: number): boolean {
    if (entity.type === "circle") return false;
    const s =
        entity.type === "line" || entity.type === "arc"
            ? parameterAt(entity, point)
            : supportParameterAt(entity, point);
    return (
        Math.abs(endParameter(entity, true, s)) <= tolerance ||
        Math.abs(endParameter(entity, false, s) - entityLength(entity)) <= tolerance
    );
}

/**
 * One end's move to the corner, or an error when what the entity is left with is not a
 * curve: a line shorter than the tolerance, an arc or an ellipseArc swept so far round
 * that it has closed on itself (`sketchNode` refuses to build that edge at all), or a
 * bezier cornered past where its support can carry it. `undefined` — no move at all —
 * is an entity that already reaches the corner.
 *
 * The corner is measured on the *support* curve (`supportParameterAt`): it lies off the
 * drawn extent by definition, and the drawn curve's own reading would clamp it back onto
 * the end it is meant to move past.
 */
function moveOf(
    side: CornerSide,
    cutter: SketchEntityData,
    point: [number, number],
    tolerance: number,
): Result<EndMove | undefined> {
    const { entity } = side;
    const end = endToMove(entity, side.end, point);
    if (end === undefined) return Result.err("The entity has no end to move");
    if (onAnEnd(entity, point, tolerance)) return Result.ok(undefined);
    const length = entityLength(entity);
    const at = endParameter(entity, end.atOrigin, supportParameterAt(entity, point));
    const remaining = end.atOrigin ? length - at : at;
    const refusal = whyNotACurve(entity, end, point, remaining, tolerance);
    if (refusal !== undefined) return Result.err(refusal);
    const replacement = freeCurveReplacement(entity, end, point, tolerance);
    if (!replacement.isOk) return Result.err(replacement.error);
    return Result.ok({
        entity,
        ref: end.ref,
        atOrigin: end.atOrigin,
        crossing: { point, s: at, cutter },
        piece: { piece: changedSpan(entity, end, at, length), role: growingSpan(entity, end, at) },
        ...(replacement.value === undefined ? {} : { replacement: replacement.value }),
    });
}

/**
 * What a free curve's move leaves in place of its control points: the piece of the *support*
 * curve between the corner's parameter and the far end. The conic and the cubic bezier
 * reparametrize it back onto [0, 1] (de Casteljau is affine, so the piece is another conic
 * or cubic); a NURBS piece is a control-point list of its own, read with its own knots — and
 * its parameters *are* its knots, so the piece keeps the original parametrization over the
 * part of the domain it covers.
 */
interface FreeCurveReplacement {
    readonly points: readonly [number, number][];
    readonly rho?: number;
    readonly weights?: readonly number[];
    readonly spec?: NurbsSpec;
}

/**
 * The control points a free curve is left with when its end moves to the corner, or
 * `undefined` for the other families — an endpoint move is all they need. A conic can run
 * out of standard form (its weights cross zero along the way) and so can the polynomial a
 * NURBS' end span is carried on with, which is the extension running off what the curve can
 * carry.
 */
function freeCurveReplacement(
    entity: SketchEntityData,
    end: PickedEnd,
    point: [number, number],
    tolerance: number,
): Result<FreeCurveReplacement | undefined> {
    if (!isFreeCurveType(entity.type)) return Result.ok(undefined);
    const { t, distance } = projectSupport(entity, point);
    // the corner came off the two support curves, and a free curve's support reaches only so
    // far past its ends (`bezierAdapter` / `nurbsAdapter`) — past that there is no curve
    if (distance > tolerance) return Result.err("The corner lies beyond where the curve can reach");
    const poles = curveControlPoints(entity);
    if (entity.type === "nurbs") {
        const spec = nurbsSpec(entity);
        const [from, to] = end.atOrigin ? [t, spec.knots[poles.length]] : [spec.knots[spec.degree], t];
        const piece = subNurbs(poles, nurbsWeights(entity.params), spec, from, to);
        if (piece === undefined) return Result.err("The corner lies beyond where the curve can reach");
        return Result.ok({ points: piece.poles, weights: piece.weights, spec: piece.spec });
    }
    const [t0, t1]: [number, number] = end.atOrigin ? [t, 1] : [0, t];
    if (entity.type === "conic") {
        const piece = subConic(poles, entity.params[6], t0, t1);
        if (piece === undefined) return Result.err("The corner lies beyond where the curve can reach");
        return Result.ok({ points: piece.poles, rho: piece.rho });
    }
    const piece = subBezier(poles, t0, t1);
    if (piece === undefined) return Result.err("The corner lies beyond where the curve can reach");
    return Result.ok({ points: piece.poles });
}

/** Why what an end's move leaves behind is not a curve the kernel will build, if it is not. */
function whyNotACurve(
    entity: SketchEntityData,
    end: PickedEnd,
    point: [number, number],
    remaining: number,
    tolerance: number,
): string | undefined {
    if (remaining <= tolerance) return "The entity would be left with nothing to extend";
    if (entity.type === "arc") {
        const sweep = remaining / entityRadiusOf(entity);
        if (sweep <= Precision.Angle) return "The arc would be left with nothing to extend";
        if (sweep >= Math.PI * 2 - Precision.Angle) return "The arc would close on itself";
        return undefined;
    }
    if (entity.type !== "ellipseArc") return undefined;
    // the sweep the move would leave, in angles: an ellipse's arclength is no measure of
    // it, and the corner's own angle on the ellipse is exact
    const [tStart, tEnd] = ellipseSweep(entity.params);
    const tCorner = ellipseParameterOf(entity.params, point);
    const full = Math.PI * 2;
    const sweep = end.atOrigin
        ? (((tEnd - tCorner) % full) + full) % full
        : (((tCorner - tStart) % full) + full) % full;
    if (sweep <= Precision.Angle) return "The ellipse arc would be left with nothing to extend";
    if (sweep >= full - Precision.Angle) return "The ellipse arc would close on itself";
    return undefined;
}

/** Whether the end is being dragged out (the span is added) or back (the span goes away). */
function growingSpan(entity: SketchEntityData, end: PickedEnd, at: number): PreviewPiece["role"] {
    return (end.atOrigin ? at < 0 : at > entityLength(entity)) ? "add" : "remove";
}

/** The span an end's move changes: what the entity gains, or what it gives up coming back. */
function changedSpan(entity: SketchEntityData, end: PickedEnd, at: number, length: number): CurvePiece {
    return end.atOrigin
        ? pieceGeometry(entity, Math.min(0, at), Math.abs(at))
        : pieceGeometry(entity, Math.min(length, at), Math.abs(at - length));
}

/**
 * Moves every end the plan asks for, and reports the constraints each move had to give up.
 * The tolerance is the plan's own, floored — the pin has to read a T-junction's cut on the
 * cutter's end the same way the plan that planned it did. A free curve's move writes the
 * whole replacement control-point set (see `EndMove.replacement`): the end lands on the
 * corner *because* the control points are the reparametrized curve's own.
 *
 * A NURBS' replacement is a control-point list of its own, so it is a *reshape* — the
 * entity keeps its id, and the constraints on control points the piece no longer has are
 * dropped (`reshapeCurve`), which is the one way an extent can cost a constraint.
 */
function applyMoves(solver: SketchSolver, moves: EndMoves, tolerance: number): Result<ExtendOutcome> {
    const removed: number[] = [];
    const entityIds: number[] = [];
    for (const move of [moves.target, moves.boundary]) {
        if (move === undefined) continue;
        const applied = applyEndMove(solver, move, tolerance, true);
        if (!applied.isOk) return Result.err(applied.error);
        removed.push(...applied.value);
        entityIds.push(move.entity.id);
    }
    return Result.ok({ entityIds, removedConstraints: removed, deletedEntities: [] });
}

/**
 * One end's move: the constraints it breaks go, the control points are re-made where the
 * family needs it, and the new end is pinned onto whatever cut it. Returns the constraints the
 * move dropped.
 *
 * `pinned` is false for the one move whose new end is *not* on the cutter: growing a source so
 * an offset copy can reach past it (`growSourceOf`), where the end lands on the source's own
 * curve and pinning it to the boundary would be a claim about a point that is not there.
 */
function applyEndMove(
    solver: SketchSolver,
    move: EndMove,
    tolerance: number,
    pinned: boolean,
): Result<number[]> {
    const removed = dropBrokenConstraints(solver, move.ref);
    const replacement = move.replacement;
    if (replacement === undefined) {
        solver.setPointPosition(move.ref, move.crossing.point[0], move.crossing.point[1]);
    } else if (replacement.spec !== undefined) {
        const reshaped = reshapeCurve(solver, move.entity, {
            poles: replacement.points.map(([u, v]) => [u, v]),
            weights: [...(replacement.weights ?? [])],
            spec: replacement.spec,
        });
        if (!reshaped.isOk) return Result.err(reshaped.error);
        removed.push(...reshaped.value);
    } else {
        replacement.points.forEach(([u, v], pointIndex) => {
            const ref: SketchPointRef = { entityId: move.entity.id, pointIndex };
            // A piece's control points are new places — the interior ones above all, since the
            // move rewrites them — so what reads them goes, exactly as a NURBS' reshape drops
            // it. The end that was moved is `move.ref`, already dropped above.
            if (pointIndex !== move.ref.pointIndex) removed.push(...dropBrokenConstraints(solver, ref));
            solver.setPointPosition(ref, u, v);
        });
        if (replacement.rho !== undefined) solver.setConicRho(move.entity.id, replacement.rho);
    }
    if (!pinned) return Result.ok(removed);
    // The pin reads the end *as it now is*: a NURBS' reshape re-makes its control-point
    // list, so the index the end carried before belongs to a pole the curve no longer has.
    const kept = solver.entity(move.entity.id);
    if (kept === undefined) return Result.err("Unknown sketch entity");
    pinCut(solver, move.atOrigin ? originEnd(kept) : farEnd(kept), move.crossing, tolerance);
    return Result.ok(removed);
}

// ------------------------------------------------------------------ The offset copy

/**
 * The end of an offset copy an extend moves, and what it asks of the source it reads.
 *
 * An offset copy has no point to move: its end is a *window* on the source
 * (`OffsetCurveRef.window`), so meeting a corner is writing the window's bound rather than
 * dragging anything. Two things follow from that, and both are in the plan below.
 *
 * The corner's parameter is read on the copy's own **support**, which is the source's range
 * (`offsetAdapter`): a corner out past the copy's drawn end still lands on the curve the copy
 * would follow were it longer, which is exactly the reading an extend of a real curve takes.
 *
 * And when the corner lies past the *source's* own end, the source is grown to reach it first.
 * That is not a nicety: off the ends of the source there is no parallel curve at all, and the
 * copy is built by offsetting the source's edge (`sketchNode`), so a copy running further than
 * its source could not be built.
 */
interface CopyExtend {
    readonly copy: SketchEntityData;
    readonly atOrigin: boolean;
    /** The corner, in sketch coordinates, on the copy's and the boundary's supports. */
    readonly corner: [number, number];
    /** The corner's parameter, on the source's own reading — the window bound it becomes. */
    readonly at: number;
    /** The source's end moving out to carry that parameter, when it has to. */
    readonly growth?: SourceGrowth;
    /** The boundary's own end brought to the corner, when `modifyBoundary` asks for it. */
    readonly boundary?: EndMove;
}

/** The source growing to reach a corner: the move, and how its parameter reads afterwards. */
interface SourceGrowth {
    readonly move: EndMove;
    readonly remap: ParameterRemap;
}

/** Where a parameter of the source *before* it grew reads on it afterwards. */
type ParameterRemap = (parameter: number) => number;

/** The pair an extend of an offset copy works on, or why there is none. */
function copyExtendPair(
    solver: SketchSolver,
    options: ExtendOptions,
): Result<{ copy: SketchEntityData; source: SketchEntityData; boundary: SketchEntityData }> {
    const copy = solver.entity(options.targetId);
    const source = copy?.offset === undefined ? undefined : solver.entity(copy.offset.sourceId);
    if (copy === undefined || copy.type !== "offsetCurve" || source === undefined) {
        return Result.err("Unknown sketch entity");
    }
    if (isClosedEntity(copy)) return Result.err("A closed copy has no end to extend");
    const boundary = solver.entity(options.boundaryId);
    if (boundary === undefined) return Result.err("Unknown sketch entity");
    if (boundary.id === copy.id) return Result.err("Pick a different entity for the boundary");
    return Result.ok({ copy, source, boundary });
}

/** Everything the extend of an offset copy would do, worked out before the solver is touched. */
function planCopyExtend(solver: SketchSolver, options: ExtendOptions, tolerance: number): Result<CopyExtend> {
    const pair = copyExtendPair(solver, options);
    if (!pair.isOk) return Result.err(pair.error);
    const { copy, source, boundary } = pair.value;

    const atOrigin = parameterAt(copy, options.targetUv) <= entityLength(copy) / 2;
    const corner = copyCorner(copy, boundary, options, atOrigin);
    if (!corner.isOk) return Result.err(corner.error);

    // the corner on the source's own reading, carried to the side of the copy the move is on
    // (`windowParameterAt`: a periodic source wraps, so a corner grown past the seam comes back
    // on the other side of it)
    const at = windowParameterAt(copy, corner.value);

    const growth = growSourceOf(source, at, atOrigin, boundary, tolerance);
    if (!growth.isOk) return Result.err(growth.error);
    const boundaryMove = planBoundaryMove(solver, options, boundary, copy, corner.value, tolerance);
    return Result.ok({
        copy,
        atOrigin,
        corner: corner.value,
        at,
        ...(growth.value === undefined ? {} : { growth: growth.value }),
        ...(boundaryMove === undefined ? {} : { boundary: boundaryMove }),
    });
}

/**
 * The corner: one of the copy's and the boundary's support crossings, preferring one the picked
 * end *grows* to reach and, between those, the one the two clicks point at — the rule
 * `bestCorner` reads for a real curve, on the copy's own parameter.
 */
function copyCorner(
    copy: SketchEntityData,
    boundary: SketchEntityData,
    options: ExtendOptions,
    atOrigin: boolean,
): Result<[number, number]> {
    const points = rawIntersections(copy, boundary);
    if (points.length === 0) return Result.err("The two entities do not meet when extended");
    const [start, end] = entityDomain(copy);
    const slack = (end - start) * 1e-9;
    const reachedOutward = (point: [number, number]) => {
        const at = windowParameterAt(copy, point);
        return atOrigin ? at < start - slack : at > end + slack;
    };
    const missed = (point: [number, number]) => (reachedOutward(point) ? 0 : 1);
    const cost = (point: [number, number]) =>
        Math.hypot(point[0] - options.targetUv[0], point[1] - options.targetUv[1]) +
        Math.hypot(point[0] - options.boundaryUv[0], point[1] - options.boundaryUv[1]);
    const sorted = [...points].sort((a, b) => missed(a) - missed(b) || cost(a) - cost(b));
    return Result.ok(sorted[0]);
}

/**
 * The source's end moving out to carry the corner, when the corner lies past it. `undefined`
 * when the source already reaches — which is every closed source (it has no end, and its copy's
 * window is read on the round), and every corner inside the source it has.
 *
 * The move is `moveOf`'s own, aimed at the corner's *preimage on the source*: the point the
 * copy sits one offset from, which is where the source's end has to be for the copy's end to
 * land on the corner. Nothing is pinned there — what the end is attached to is the source's own
 * curve, and there is no constraint saying "this end is the extension of this curve".
 */
function growSourceOf(
    source: SketchEntityData,
    at: number,
    atOrigin: boolean,
    boundary: SketchEntityData,
    tolerance: number,
): Result<SourceGrowth | undefined> {
    const [start, end] = entityDomain(source);
    const beyond = atOrigin ? at < start - (end - start) * 1e-9 : at > end + (end - start) * 1e-9;
    if (!beyond || entityPeriod(source) > 0) return Result.ok(undefined);
    const point = evaluateEntity(source, at);
    const move = moveOf(
        { entity: source, uv: point, end: { atOrigin, ref: atOrigin ? originEnd(source) : farEnd(source) } },
        boundary,
        point,
        tolerance,
    );
    if (!move.isOk) return Result.err(move.error);
    if (move.value === undefined) return Result.ok(undefined);
    return Result.ok({ move: move.value, remap: sourceRemap(source, at, atOrigin) });
}

/**
 * How the source's parameter reads after it has been grown out to `at`. A bezier, a conic and
 * a line are re-made over the span they end up covering (`subBezier` and kin reparametrize the
 * grown piece onto the whole of it), so every other parameter on them moves with it. A NURBS
 * keeps its knots and an ellipse arc its angles, which are the same numbers before and after —
 * the piece each is grown by is taken at the parameter the corner already named.
 */
function sourceRemap(source: SketchEntityData, at: number, atOrigin: boolean): ParameterRemap {
    if (source.type !== "bezier" && source.type !== "conic" && source.type !== "line") {
        return (parameter) => parameter;
    }
    return atOrigin ? (parameter) => (parameter - at) / (1 - at) : (parameter) => parameter / at;
}

/**
 * The boundary's own end brought to the corner, when the option asks for it and the boundary
 * has an end to bring. Its move is `moveOf`'s, cut by the copy — and the pin it would leave
 * falls away on its own, since an offset copy has no PointOn for a point to be held by (see
 * `pinCut`). A move the boundary has no way to make falls away too, exactly as it does for a
 * real target: the copy's own extension is the gesture's point either way.
 */
function planBoundaryMove(
    solver: SketchSolver,
    options: ExtendOptions,
    boundary: SketchEntityData,
    copy: SketchEntityData,
    corner: [number, number],
    tolerance: number,
): EndMove | undefined {
    if (!options.modifyBoundary || solver.isFixed(boundary.id)) return undefined;
    const end = pickedEnd(boundary, options.boundaryUv);
    if (end === undefined) return undefined;
    const move = moveOf({ entity: boundary, uv: options.boundaryUv, end }, copy, corner, tolerance);
    return !move.isOk || move.value === undefined ? undefined : move.value;
}

/** Carries out an offset copy's extend: the source's growth, then the window, then the boundary. */
function applyCopyExtend(solver: SketchSolver, plan: CopyExtend, tolerance: number): Result<ExtendOutcome> {
    const removed: number[] = [];
    const entityIds: number[] = [plan.copy.id];
    if (plan.growth !== undefined) {
        const grown = applyEndMove(solver, plan.growth.move, tolerance, false);
        if (!grown.isOk) return Result.err(grown.error);
        removed.push(...grown.value);
        entityIds.push(plan.growth.move.entity.id);
    }
    const remap = plan.growth?.remap ?? ((parameter: number) => parameter);
    const [start, end] = entityDomain(plan.copy);
    const window: [number, number] = plan.atOrigin
        ? [remap(plan.at), remap(end)]
        : [remap(start), remap(plan.at)];
    const written = solver.setOffsetWindow(plan.copy.id, window);
    if (!written.isOk) return Result.err(written.error);
    if (plan.boundary !== undefined) {
        const moved = applyEndMove(solver, plan.boundary, tolerance, true);
        if (!moved.isOk) return Result.err(moved.error);
        removed.push(...moved.value);
        entityIds.push(plan.boundary.entity.id);
    }
    return Result.ok({ entityIds, removedConstraints: removed, deletedEntities: [] });
}

/** The spans a planned extend would change, as the editor draws them. */
function copyPreviewPieces(plan: CopyExtend): PreviewPiece[] {
    const length = entityLength(plan.copy);
    const end: PickedEnd = {
        atOrigin: plan.atOrigin,
        ref: { entityId: plan.copy.id, pointIndex: plan.atOrigin ? 0 : 1 },
    };
    const at = supportParameterAt(plan.copy, plan.corner);
    const pieces: PreviewPiece[] = [
        { piece: changedSpan(plan.copy, end, at, length), role: growingSpan(plan.copy, end, at) },
    ];
    if (plan.growth !== undefined) {
        // the span the *source* gains, read on the source the way its own extend reads one
        const move = plan.growth.move;
        const at = supportParameterAt(move.entity, move.crossing.point);
        pieces.push({
            piece: changedSpan(move.entity, move, at, entityLength(move.entity)),
            role: growingSpan(move.entity, move, at),
        });
    }
    if (plan.boundary !== undefined) pieces.push(plan.boundary.piece);
    return pieces;
}
