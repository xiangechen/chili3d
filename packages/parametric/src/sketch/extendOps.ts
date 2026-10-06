// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
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
} from "./curveGeometry";
import { dropBrokenConstraints, type EditOutcome, guardedEdit, pinCut } from "./entityEditOps";
import type { PreviewPiece } from "./previewTypes";
import type { SketchEntityData, SketchPointRef } from "./sketchModel";
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
    readonly crossing: CurveCrossing;
    readonly piece: PreviewPiece;
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
    /** The entity to prolong: a line or an arc — a circle has no end to move. */
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
    const plan = planExtend(solver, options, tolerance);
    if (!plan.isOk) return Result.err(plan.error);
    return guardedEdit(solver, "the extend", () => Result.ok(applyMoves(solver, plan.value, tolerance)));
}

/**
 * The spans an extend under the same options would change, or `undefined` when it would
 * refuse there. The editor draws these under the cursor while the boundary pick is up, so
 * what the click will do is visible before it is done — and, since the plan is the very one
 * the op applies, the two cannot drift.
 */
export function extendPreview(solver: SketchSolver, options: ExtendOptions): PreviewPiece[] | undefined {
    const plan = planExtend(solver, options, sketchTolerance(options.tolerance));
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

function planExtend(solver: SketchSolver, options: ExtendOptions, tol: number): Result<EndMoves> {
    const target = solver.entity(options.targetId);
    if (target === undefined) return Result.err("Unknown sketch entity");
    // the datum and the external references are reference geometry: they cut, but they
    // are never cut up
    if (solver.isFixed(target.id)) return Result.err("The datum and external references cannot be extended");
    if (target.type === "circle") return Result.err("A circle has no end to extend");
    const boundary = solver.entity(options.boundaryId);
    if (boundary === undefined) return Result.err("Unknown sketch entity");
    if (boundary.id === target.id) return Result.err("Pick a different entity for the boundary");

    // a boundary with no ends of its own (a circle, a datum axis) is met but never moved
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
 * support curve. A candidate inside the entity is one the end would have to back into
 * instead, which is what makes the ranking prefer the crossing the user was pointing at.
 */
function reachedOutward(side: CornerSide, point: [number, number], tolerance: number): boolean {
    if (side.end === undefined) return false;
    const at = endParameter(side.entity, side.end.atOrigin, parameterAt(side.entity, point));
    return side.end.atOrigin ? at < -tolerance : at > entityLength(side.entity) + tolerance;
}

/** Which end of the entity a click at `uv` aims at: the nearer one. A circle has none. */
function pickedEnd(entity: SketchEntityData, uv: [number, number]): PickedEnd | undefined {
    if (entity.type === "circle") return undefined;
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
 * so nothing but the click can say which was meant.
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
 * `parameterAt` is already signed; an arc's wraps into [0, 2πR), so an origin end dragged
 * backwards has its corner behind the seam and the wrap is undone before the extent is
 * measured against it — which is why `atOrigin` has to be asked for rather than assumed.
 * The far end never needs the undo: moving it outward stops short of the full turn
 * (`moveOf` refuses the arc that would close), and past the far end the raw wrap is the
 * reading that says so.
 */
function endParameter(entity: SketchEntityData, atOrigin: boolean, s: number): number {
    if (entity.type !== "arc" || !atOrigin) return s;
    return s <= entityLength(entity) ? s : s - Math.PI * 2 * entityRadiusOf(entity);
}

/**
 * Whether the corner sits on one of the entity's own ends — either end, not just the one
 * the click picked. The entity reaches the corner either way, so nothing has to move.
 * Asking the picked end alone gets the arc wrong: its two ends lie on the same circle and
 * `endToMove` never re-decides it, so a click near one end and a corner on the other reads
 * as a move that swallows the whole arc.
 */
function onAnEnd(entity: SketchEntityData, point: [number, number], tolerance: number): boolean {
    if (entity.type === "circle") return false;
    const s = parameterAt(entity, point);
    return (
        Math.abs(endParameter(entity, true, s)) <= tolerance ||
        Math.abs(endParameter(entity, false, s) - entityLength(entity)) <= tolerance
    );
}

/**
 * One end's move to the corner, or an error when what the entity is left with is not a
 * curve: a line shorter than the tolerance, or an arc swept so far round that it has closed
 * on itself (`sketchNode` refuses to build that edge at all). `undefined` — no move at all —
 * is an entity that already reaches the corner.
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
    const at = endParameter(entity, end.atOrigin, parameterAt(entity, point));
    const remaining = end.atOrigin ? length - at : at;
    const refusal = whyNotACurve(entity, remaining, tolerance);
    if (refusal !== undefined) return Result.err(refusal);
    return Result.ok({
        entity,
        ref: end.ref,
        crossing: { point, s: at, cutter },
        piece: { piece: changedSpan(entity, end, at, length), role: growingSpan(entity, end, at) },
    });
}

/** Why what an end's move leaves behind is not a curve the kernel will build, if it is not. */
function whyNotACurve(entity: SketchEntityData, remaining: number, tolerance: number): string | undefined {
    if (remaining <= tolerance) return "The entity would be left with nothing to extend";
    if (entity.type !== "arc") return undefined;
    const sweep = remaining / entityRadiusOf(entity);
    if (sweep <= Precision.Angle) return "The arc would be left with nothing to extend";
    if (sweep >= Math.PI * 2 - Precision.Angle) return "The arc would close on itself";
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
 * cutter's end the same way the plan that planned it did.
 */
function applyMoves(solver: SketchSolver, moves: EndMoves, tolerance: number): ExtendOutcome {
    const removed: number[] = [];
    const entityIds: number[] = [];
    for (const move of [moves.target, moves.boundary]) {
        if (move === undefined) continue;
        removed.push(...dropBrokenConstraints(solver, move.ref));
        solver.setPointPosition(move.ref, move.crossing.point[0], move.crossing.point[1]);
        pinCut(solver, move.ref, move.crossing, tolerance);
        entityIds.push(move.entity.id);
    }
    return { entityIds, removedConstraints: removed, deletedEntities: [] };
}
