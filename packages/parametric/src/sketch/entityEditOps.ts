// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
import { curveControlPoints, nurbsSpec, nurbsWeights, subBezier, subConic, subNurbs } from "./curveEval";
import { type CurveCrossing, entityEndIndices, farEnd } from "./curveGeometry";
import {
    ConstraintKind,
    entityPointCount,
    isDatumEntityId,
    isStructuralConstraint,
    type NurbsSpec,
    pointRefKey,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver, SolveOutcome } from "./solver";
import {
    arcStartRef,
    centerRef,
    isCurveAnchorRef,
    pointOnConstraintFor,
    tangentConstraintFor,
} from "./solverEntities";

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
 * point snaps onto geometry, and the one FreeCAD's trim documents. Every entity type
 * has its PointOn kind (`pointOnConstraintFor`), the datum axes included — an axis is
 * a line stored as its own unit segment, and the line's refs serve both.
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
    const incidence = pointOnConstraintFor(cut.cutter.type, ref, cut.cutter.id);
    if (incidence !== undefined) solver.addConstraint(incidence);
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
    // a closed curve's only points are its frame (a circle's centre, an ellipse's axes),
    // which no crossing point can be
    const indices = entityEndIndices(cutter);
    if (indices === undefined) return undefined;
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
 *
 * The conic/bezier/nurbs kinds read the curve through one *entity anchor* ref
 * (`{entity, 0}` — a centre the ops never slide, or a free curve the ops reshape only
 * while keeping the part of it the constraint reads), so their anchor slots survive the
 * slide the same way the arc's radius slot does.
 */
const SLIDE_SAFE_REFS: ReadonlyMap<ConstraintKind, ReadonlySet<number>> = new Map([
    [ConstraintKind.Horizontal, new Set([0, 1])],
    [ConstraintKind.Vertical, new Set([0, 1])],
    [ConstraintKind.Parallel, new Set([0, 1, 2, 3])],
    [ConstraintKind.Perpendicular, new Set([0, 1, 2, 3])],
    [ConstraintKind.Angle, new Set([0, 1, 2, 3])],
    [ConstraintKind.PointOnLine, new Set([1, 2])],
    [ConstraintKind.PointOnEllipse, new Set([1])],
    [ConstraintKind.PointOnConic, new Set([1])],
    [ConstraintKind.PointOnBezier, new Set([1])],
    [ConstraintKind.PointOnNurbs, new Set([1])],
    [ConstraintKind.P2LDistance, new Set([1, 2])],
    [ConstraintKind.Symmetric, new Set([2, 3])],
    [ConstraintKind.TangentLineCircle, new Set([0, 1])],
    [ConstraintKind.TangentLineArc, new Set([0, 1, 3])],
    [ConstraintKind.TangentLineEllipse, new Set([0, 1])],
    [ConstraintKind.TangentLineConic, new Set([0, 1])],
    [ConstraintKind.TangentLineBezier, new Set([0, 1])],
    [ConstraintKind.TangentLineNurbs, new Set([0, 1])],
    [ConstraintKind.TangentCircleArc, new Set([2])],
    [ConstraintKind.TangentArcArc, new Set([1, 3])],
    [ConstraintKind.TangentCircleEllipse, new Set([0, 1])],
    [ConstraintKind.TangentArcEllipse, new Set([0, 1])],
    [ConstraintKind.TangentEllipseEllipse, new Set([0, 1])],
    [ConstraintKind.TangentEllipseConic, new Set([0, 1])],
    [ConstraintKind.TangentEllipseBezier, new Set([0, 1])],
    [ConstraintKind.TangentEllipseNurbs, new Set([0, 1])],
    [ConstraintKind.TangentCircleConic, new Set([0, 1])],
    [ConstraintKind.TangentArcConic, new Set([0, 1])],
    [ConstraintKind.TangentConicConic, new Set([0, 1])],
    [ConstraintKind.TangentCircleBezier, new Set([0, 1])],
    [ConstraintKind.TangentCircleNurbs, new Set([0, 1])],
    [ConstraintKind.TangentArcBezier, new Set([0, 1])],
    [ConstraintKind.TangentArcNurbs, new Set([0, 1])],
    [ConstraintKind.TangentConicBezier, new Set([0, 1])],
    [ConstraintKind.TangentConicNurbs, new Set([0, 1])],
    [ConstraintKind.TangentBezierBezier, new Set([0, 1])],
    [ConstraintKind.TangentBezierNurbs, new Set([0, 1])],
    [ConstraintKind.TangentNurbsNurbs, new Set([0, 1])],
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
 * unknown and the pieces drift apart under a drag. An ellipseArc's halves share the whole
 * ellipse frame (centre and both axis points) for the same reason: the structural
 * PointOnEllipse pins each half's rim points to *its own* frame, and only the
 * coincidences make the two frames one ellipse.
 *
 * The free curves are not here because an endpoint move cannot express them: their far half
 * is a reparametrization of the whole control-point set, which is `splitCurveEntity`.
 */
export function addFarHalf(
    solver: SketchSolver,
    entity: SketchEntityData,
    start: [number, number],
    end: [number, number],
): number {
    let newId: number;
    if (entity.type === "ellipseArc") {
        const [cx, cy, mx, my, nx, ny] = entity.params;
        newId = solver.addEllipseArc(cx, cy, mx, my, nx, ny, start[0], start[1], end[0], end[1]);
        for (const pointIndex of [0, 1, 2]) {
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: entity.id, pointIndex },
                    { entityId: newId, pointIndex },
                ],
            });
        }
    } else {
        newId =
            entity.type === "line"
                ? solver.addLine(start[0], start[1], end[0], end[1])
                : solver.addArc(entity.params[0], entity.params[1], start[0], start[1], end[0], end[1]);
        if (entity.type === "arc") {
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [centerRef(entity.id), centerRef(newId)],
            });
        }
    }
    if (solver.isConstruction(entity.id)) solver.setConstruction(newId, true);
    return newId;
}

/** A NURBS piece: its control points, their weights and the knots they are read with. */
export interface NurbsPiece {
    readonly poles: [number, number][];
    readonly weights: number[];
    readonly spec: NurbsSpec;
}

/** What carving a curve left behind. */
export interface CurveSplit {
    /** The far half, as an entity of its own. */
    readonly newId: number;
    /** Constraints the kept half's reshape could not carry (see `reshapeCurve`). */
    readonly dropped: number[];
}

/** A conic or cubic bezier piece: its control points and, for a conic, the rho they are read with. */
interface BezierPiece {
    readonly poles: [number, number][];
    readonly rho?: number;
}

/** The half a split keeps, in the form its own family hands a piece over in. */
type KeptPiece = NurbsPiece | BezierPiece;

/**
 * Carves a curve in two at its natural parameters: the piece from the domain's start to
 * `tKeep` stays with the entity — its id, its anchors and its place in a ProfileRef — and
 * the piece from `tNew` to the domain's end is added as a new entity. Both halves trace the
 * curve the entity was, so the cuts land exactly on it.
 *
 * The conic and the cubic bezier split by de Casteljau: their pieces are reparametrizations
 * of the *original* poles, so the pole count survives and only the places change. A NURBS
 * cannot: a split adds control points and its knots decide where they sit, so the kept piece
 * is reshaped (`reshapeCurve`) and costs the constraints on the control points it no longer
 * has.
 *
 * The far point's constraints are moved onto the new half here rather than by the caller:
 * only the split knows which of the half's own points it is — a NURBS numbers its control
 * points afresh around the piece, and the far end sits at the half's end, not at the index
 * it had.
 *
 * `undefined`-backed refusals: a conic piece whose weights run through zero has no standard
 * form (`subConic`), and a NURBS piece whose weights do the same has no curve at all.
 */
export function splitCurveEntity(
    solver: SketchSolver,
    entity: SketchEntityData,
    tKeep: number,
    tNew: number,
): Result<CurveSplit> {
    const cut: Result<{ newId: number; piece: KeptPiece }> =
        entity.type === "nurbs"
            ? splitNurbsEntity(solver, entity, tKeep, tNew)
            : splitBezierEntity(solver, entity, tKeep, tNew);
    if (!cut.isOk) return Result.err(cut.error);
    // The far end's constraints move to the half that now holds that point *before* the kept
    // half is reshaped: a reshape drops every constraint on a control point the piece no longer
    // has, and the far end is one of them once the cut has moved the last pole — waiting until
    // afterwards would find nothing left to move, and the joint would go with it.
    migrateConstraints(
        solver,
        entity,
        farEnd(entity),
        cut.value.newId,
        farIndexOn(solver, entity, cut.value.newId),
    );
    const reshaped = reshapeKeptPiece(solver, entity, cut.value.piece);
    if (!reshaped.isOk) return Result.err(reshaped.error);
    return Result.ok({ newId: cut.value.newId, dropped: reshaped.value });
}

/** The kept half, reshaped in place from the piece the split cut out of it. */
function reshapeKeptPiece(
    solver: SketchSolver,
    entity: SketchEntityData,
    piece: KeptPiece,
): Result<number[]> {
    return entity.type === "nurbs"
        ? reshapeCurve(solver, entity, piece as NurbsPiece)
        : reshapeBezierPiece(solver, entity, piece as BezierPiece);
}

/** The de Casteljau half of `splitCurveEntity`, for a conic or a cubic bezier. */
function splitBezierEntity(
    solver: SketchSolver,
    entity: SketchEntityData,
    tKeep: number,
    tNew: number,
): Result<{ newId: number; piece: KeptPiece }> {
    const poles = curveControlPoints(entity);
    const cut = (t0: number, t1: number): BezierPiece | undefined =>
        entity.type === "conic" ? subConic(poles, entity.params[6], t0, t1) : subBezier(poles, t0, t1);
    const kept = cut(0, tKeep);
    const added = cut(tNew, 1);
    if (kept === undefined || added === undefined) {
        return Result.err("The curve cannot be split there");
    }
    const flat = added.poles.flat();
    const newId =
        entity.type === "conic" && added.rho !== undefined
            ? solver.addConic(flat[0], flat[1], flat[2], flat[3], flat[4], flat[5], added.rho)
            : solver.addBezier(flat);
    if (solver.isConstruction(entity.id)) solver.setConstruction(newId, true);
    return Result.ok({ newId, piece: kept });
}

/** The NURBS half of `splitCurveEntity`: two knot-insertion slices, one of them in place. */
function splitNurbsEntity(
    solver: SketchSolver,
    entity: SketchEntityData,
    tKeep: number,
    tNew: number,
): Result<{ newId: number; piece: KeptPiece }> {
    const poles = curveControlPoints(entity);
    const weights = nurbsWeights(entity.params);
    const spec = nurbsSpec(entity);
    const kept = subNurbs(poles, weights, spec, spec.knots[spec.degree], tKeep);
    const added = subNurbs(poles, weights, spec, tNew, spec.knots[poles.length]);
    if (kept === undefined || added === undefined) {
        return Result.err("The curve cannot be split there");
    }
    const newId = solver.addNurbs(added.poles.flat(), added.spec, added.weights);
    if (solver.isConstruction(entity.id)) solver.setConstruction(newId, true);
    return Result.ok({ newId, piece: kept });
}

/**
 * Reshapes a free curve in place: the entity keeps its id — and with it its dimension
 * anchors, its place in a ProfileRef, and every *curve-level* ref its constraints hold (a
 * PointOnNurbs still reads the same curve, however much of it is left) — and swaps its whole
 * param set for the piece's, which is the only way a NURBS piece can be expressed.
 *
 * What a reshape cannot carry is a *point* ref. The piece's control points are its own, so a
 * constraint reading one survives only where the piece has that control point, at the very
 * coordinates it was at — and the curve's clamped ends are control points on the curve, which
 * is why an endpoint's constraint survives a cut at the other end. The ones that do not
 * survive are dropped, and their ids returned: the caller has to prune the dimension anchors
 * they orphaned, exactly as it does for the constraints a trim's crossing removes.
 */
export function reshapeCurve(
    solver: SketchSolver,
    entity: SketchEntityData,
    piece: NurbsPiece,
): Result<number[]> {
    return solver.retypeEntity(
        entity.id,
        "nurbs",
        [...piece.poles.flat(), ...piece.weights],
        (constraint) => survivedReshape(entity, piece.poles, constraint),
        piece.spec,
    );
}

/**
 * Remakes a conic or a cubic bezier in place from `piece`. The family's pole count does not
 * change, so there is no retype to do beyond writing the piece's control points — but the
 * interior ones are *new* points, so a constraint reading one is dropped exactly as a NURBS'
 * reshape drops it (`keepsControlPoint`), and its id comes back to be reported.
 */
function reshapeBezierPiece(
    solver: SketchSolver,
    entity: SketchEntityData,
    piece: { poles: [number, number][]; rho?: number },
): Result<number[]> {
    const values =
        entity.type === "conic" ? [...piece.poles.flat(), piece.rho ?? entity.params[6]] : piece.poles.flat();
    return solver.retypeEntity(entity.id, entity.type, values, (constraint) =>
        survivedReshape(entity, piece.poles, constraint),
    );
}

/**
 * Cuts a free curve back to `tCut`, leaving the stretch on one side of it: the same curve
 * shortened is a different control-point set, so the entity is remade in place from the
 * piece — a conic's or a cubic's control points written over the ones it has, a NURBS' whole
 * set swapped for the piece's — and keeps its id either way. `atOrigin` says which side
 * goes: the part before the cut, or the part after it.
 *
 * Returns the constraints the remake dropped, in the terms `reshapeCurve` sets out.
 */
export function shortenCurveEntity(
    solver: SketchSolver,
    entity: SketchEntityData,
    tCut: number,
    atOrigin: boolean,
): Result<number[]> {
    const poles = curveControlPoints(entity);
    const [from, to] = atOrigin ? [tCut, 1] : [0, tCut];
    if (entity.type === "nurbs") {
        // a NURBS is parameterized by its knots: its domain runs from the first clamped knot
        // to the last, not from 0 to 1
        const spec = nurbsSpec(entity);
        const piece = subNurbs(
            poles,
            nurbsWeights(entity.params),
            spec,
            atOrigin ? tCut : spec.knots[spec.degree],
            atOrigin ? spec.knots[poles.length] : tCut,
        );
        if (piece === undefined) return Result.err("The curve cannot be cut back there");
        return reshapeCurve(solver, entity, piece);
    }
    const piece =
        entity.type === "conic" ? subConic(poles, entity.params[6], from, to) : subBezier(poles, from, to);
    if (piece === undefined) return Result.err("The curve cannot be cut back there");
    return reshapeBezierPiece(solver, entity, piece);
}

/** A constraint as the reshaped curve leaves it; `undefined` when no ref of it is left. */
function survivedReshape(
    entity: SketchEntityData,
    poles: readonly [number, number][],
    constraint: SketchConstraintData,
): Omit<SketchConstraintData, "id"> | undefined {
    const refs: SketchPointRef[] = [];
    for (const [slot, ref] of constraint.refs.entries()) {
        if (ref.entityId !== entity.id || isCurveAnchorRef(constraint.kind, slot)) {
            refs.push(ref);
            continue;
        }
        if (!keepsControlPoint(entity, poles, ref.pointIndex)) return undefined;
        refs.push(ref);
    }
    return { kind: constraint.kind, refs, ...readingOf(constraint) };
}

/** Whether the piece still has the control point `pointIndex` names, where it was. */
function keepsControlPoint(
    entity: SketchEntityData,
    poles: readonly [number, number][],
    pointIndex: number,
): boolean {
    const pole = poles[pointIndex];
    if (pole === undefined) return false;
    return (
        Math.hypot(pole[0] - entity.params[pointIndex * 2], pole[1] - entity.params[pointIndex * 2 + 1]) <=
        Precision.Distance
    );
}

/**
 * Where the far end sits on the half a split added. A NURBS numbers its control points
 * afresh — the half's own last one is the point the original ended at — while every other
 * family hands the point over at the index it already had.
 */
function farIndexOn(solver: SketchSolver, entity: SketchEntityData, newId: number): number {
    if (entity.type !== "nurbs") return farEnd(entity).pointIndex;
    const half = solver.entity(newId);
    return half === undefined ? 0 : entityPointCount(half) - 1;
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
 *
 * `farIndex` is the point the far end sits at *on the new half*, which is not always the
 * index it had: a NURBS numbers its control points afresh around the piece, so its far end
 * is the half's last one (`splitCurveEntity` passes what it worked out). The direction
 * kinds below are the line's, which no free curve carries, so the override never has to
 * reach them.
 */
export function migrateConstraints(
    solver: SketchSolver,
    entity: SketchEntityData,
    far: SketchPointRef,
    newId: number,
    farIndex = far.pointIndex,
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
                    pointRefKey(ref) === farKey ? { ...ref, entityId: newId, pointIndex: farIndex } : ref,
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

// ------------------------------------------------------------------ Closed → open curve constraints

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
        case ConstraintKind.TangentCircleEllipse:
        case ConstraintKind.TangentCircleConic:
        case ConstraintKind.TangentCircleBezier:
        case ConstraintKind.TangentCircleNurbs:
            return convertedTangent(solver, constraint, id, "arc");
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

/** A tangency re-stated for the retyped entity: the same pair, one side now `type`. */
function convertedTangent(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
    type: SketchEntityType,
): Omit<SketchConstraintData, "id"> | undefined {
    const ids = [...new Set(constraint.refs.map((ref) => ref.entityId))];
    if (ids.length !== 2 || !ids.includes(id)) return undefined;
    const typeOf = (entityId: number): SketchEntityType | undefined =>
        entityId === id ? type : solver.entity(entityId)?.type;
    return tangentConstraintFor(typeOf(ids[0]), ids[0], typeOf(ids[1]), ids[1]);
}

/**
 * An ellipse's constraint as the same relation on the ellipseArc it became — the trim's
 * and the break's other retype, beside `circleToArcConstraint`. The frame (centre and
 * both axis points) survives the swap unchanged, so every relation reading it carries
 * over as it is: a PointOnEllipse still reads the same ellipse, a tangency is re-stated
 * for the same pair of curves, and the structural perpendicularity is rebuilt by the
 * retype itself rather than converted here.
 */
export function ellipseToArcConstraint(
    solver: SketchSolver,
    constraint: SketchConstraintData,
    id: number,
): Omit<SketchConstraintData, "id"> | undefined {
    switch (constraint.kind) {
        case ConstraintKind.TangentLineEllipse:
        case ConstraintKind.TangentCircleEllipse:
        case ConstraintKind.TangentArcEllipse:
        case ConstraintKind.TangentEllipseEllipse:
        case ConstraintKind.TangentEllipseConic:
        case ConstraintKind.TangentEllipseBezier:
        case ConstraintKind.TangentEllipseNurbs:
            return convertedTangent(solver, constraint, id, "ellipseArc");
        default:
            return { kind: constraint.kind, refs: constraint.refs, ...readingOf(constraint) };
    }
}
