// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
import {
    ellipseParameterOf,
    entityDomain,
    evaluateEntity,
    isClosedCurveType,
    isFreeCurveType,
    projectPoint,
} from "./curveEval";
import { entityRadiusOf, farEnd, normalizeAngle, originEnd, parameterAt, pointAt } from "./curveGeometry";
import {
    addFarHalf,
    circleToArcConstraint,
    type EditOutcome,
    ellipseToArcConstraint,
    equalArcRadiusBetween,
    guardedEdit,
    migrateConstraints,
    splitCurveEntity,
} from "./entityEditOps";
import type { SketchOperationResult } from "./sketchError";
import { ConstraintKind, type SketchEntityData } from "./sketchModel";
import type { SketchSolver } from "./solver";

/** What a break leaves behind (see `EditOutcome`). */
export type BreakOutcome = EditOutcome;

/**
 * Carves `entityId` at the clicked points. `uvs` is one position for an open curve and
 * two for a closed one; each is projected onto the entity, so a click near the curve
 * still cuts on it. The half holding the entity's origin keeps its id — the same choice
 * the trim's split makes — so its dimension anchors stay put.
 */
export function breakEntity(
    solver: SketchSolver,
    entityId: number,
    uvs: readonly [number, number][],
    tolerance: number,
): SketchOperationResult<BreakOutcome> {
    const tol = Math.max(tolerance, 1e-6);
    const entity = solver.entity(entityId);
    if (entity === undefined) return Result.err("Unknown sketch entity");
    // a point has no curve, so there is no span of it to cut pieces out of
    if (entity.type === "point") return Result.err("A point cannot be broken");
    // a text is a placement, not a span of curve: there is no parameter to carve it at
    if (entity.type === "text") return Result.err("A text cannot be broken");
    // the datum and the external references are reference geometry: they cut, but they
    // are never cut up
    // An offset copy is `derived` too, and it *is* cut up — but only by the trim and the
    // extend, which write the window it is drawn over (`trimOps`, `extendOps`). A break into N
    // pieces has no such path yet, so it is refused with what is actually the matter rather
    // than with the datum's own reason.
    if (solver.isFixed(entityId)) {
        return Result.err(
            entity.type === "offsetCurve"
                ? "An offset copy cannot be broken; trim the piece away instead"
                : "The datum and external references cannot be broken",
        );
    }
    const cuts = planCuts(entity, uvs, tol);
    if (!cuts.isOk) return Result.err(cuts.error);
    return guardedEdit(solver, "the break", () => {
        if (entity.type === "circle") return carveCircle(solver, entity, cuts.value);
        if (entity.type === "ellipse") return carveEllipse(solver, entity, cuts.value);
        return carve(solver, entity, cuts.value[0]);
    });
}

/**
 * The points a break under the same clicks would cut at, in sketch terms; empty where it
 * would refuse. The editor draws these under the cursor while the pick is up, so the cut is
 * visible before it is made — the closed curve's two points included, which is why the
 * command hands back the one it already has.
 *
 * A closed curve's preview stops short of the two-arc test the op applies: the marker has
 * to stay on screen while the user moves to the second point, and refusing there would
 * blank the very cue they are aiming with. That refusal surfaces on the click instead.
 */
export function breakPreview(
    solver: SketchSolver,
    entityId: number,
    uvs: readonly [number, number][],
    tolerance: number,
): [number, number][] {
    const entity = solver.entity(entityId);
    // a text draws no cut points either: like a point, it has no span to carve
    if (
        entity === undefined ||
        solver.isFixed(entityId) ||
        entity.type === "point" ||
        entity.type === "text"
    ) {
        return [];
    }
    const tol = Math.max(tolerance, 1e-6);
    if (isClosedCurveType(entity.type)) return uvs.slice(0, 2).map((uv) => projected(entity, uv));
    if (uvs.length === 0) return [];
    return atOwnEnd(entity, uvs[0], tol) ? [] : [projected(entity, uvs[0])];
}

/** Every cut a break would make, or why it refuses. */
function planCuts(
    entity: SketchEntityData,
    uvs: readonly [number, number][],
    tolerance: number,
): Result<[number, number][]> {
    if (!isClosedCurveType(entity.type)) {
        if (uvs.length === 0) return Result.err("Pick a point along the entity");
        if (atOwnEnd(entity, uvs[0], tolerance)) {
            return Result.err("Pick a point along the entity, not one of its ends");
        }
        return Result.ok([projected(entity, uvs[0])]);
    }
    if (uvs.length < 2) {
        return Result.err(
            entity.type === "circle"
                ? "A circle needs a second point to break at"
                : "An ellipse needs a second point to break at",
        );
    }
    const cuts: [number, number][] = [projected(entity, uvs[0]), projected(entity, uvs[1])];
    const sweeps = closedSweeps(entity, cuts[0], cuts[1]);
    if (sweeps.some((sweep) => sweep <= Precision.Angle || sweep >= Math.PI * 2 - Precision.Angle)) {
        return Result.err(
            entity.type === "circle"
                ? "Pick two points further apart along the circle"
                : "Pick two points further apart along the ellipse",
        );
    }
    return Result.ok(cuts);
}

/** Whether the click sits at (or within the tolerance of) one of the entity's own ends. */
function atOwnEnd(entity: SketchEntityData, uv: [number, number], tolerance: number): boolean {
    // Read by position, for the reason `trimOps.atOwnEnd` records: the arclength a click reads
    // (`parameterAt`'s quadrature) and the drawn polyline's own (`entityLength`)
    // disagree by ~2e-4 on a numeric curve — far above this tolerance — so a click that landed on
    // the entity's own end slipped past an arclength test and the break cut there.
    const [from, to] = entityDomain(entity);
    const ends: [number, number][] = [evaluateEntity(entity, from), evaluateEntity(entity, to)];
    return ends.some((end) => Math.hypot(uv[0] - end[0], uv[1] - end[1]) <= tolerance);
}

/** The click projected onto the entity: the cut lands on the curve, not beside it. */
function projected(entity: SketchEntityData, uv: [number, number]): [number, number] {
    return pointAt(entity, parameterAt(entity, uv));
}

/** The two sweeps, in radians, a closed curve cut at `first` and `second` would leave behind. */
function closedSweeps(
    entity: SketchEntityData,
    first: [number, number],
    second: [number, number],
): [number, number] {
    // an ellipse's angles are its own parameters, not a length over a radius
    const forward =
        entity.type === "ellipse"
            ? normalizeAngle(
                  ellipseParameterOf(entity.params, second) - ellipseParameterOf(entity.params, first),
              )
            : normalizeAngle(
                  (parameterAt(entity, second) - parameterAt(entity, first)) / entityRadiusOf(entity),
              );
    return [forward, Math.PI * 2 - forward];
}

// ------------------------------------------------------------------ Carving an entity

/**
 * Cuts an open curve in two at `point`: the entity keeps its id and its origin end, the
 * far half is added, and the endpoint they now share is pinned to the other half — the joint
 * the trim's split gets for free from the cutter it pins both ends to, which a break has to
 * state outright because nothing cut it.
 *
 * The far end keeps its identity, so its constraints follow it onto the new half and the
 * ones spanning the cut still read the points they always read — except on a NURBS, whose
 * kept piece is *reshaped* rather than reparametrized: the split reports the constraints on
 * control points it no longer has, and those ids come back to be pruned. The free curves
 * express the cut by re-making their control-point list (`splitCurveEntity`) rather than by
 * moving an end, which the line, arc and ellipseArc do.
 */
function carve(
    solver: SketchSolver,
    entity: SketchEntityData,
    point: [number, number],
): Result<BreakOutcome> {
    const far = farEnd(entity);
    const farPoint = solver.pointOf(far);
    let newId: number;
    let dropped: number[] = [];
    if (isFreeCurveType(entity.type)) {
        const t = projectPoint(entity, point).t;
        const carved = splitCurveEntity(solver, entity, t, t);
        if (!carved.isOk) return Result.err(carved.error);
        newId = carved.value.newId;
        dropped = carved.value.dropped;
    } else {
        solver.setPointPosition(far, point[0], point[1]);
        newId = addFarHalf(solver, entity, point, farPoint);
        migrateConstraints(solver, entity, far, newId);
    }
    // The joint, stated by the refs the two halves actually have: a NURBS half numbers its
    // control points afresh around the cut, so the kept half's far end is its own last one
    // rather than the index the original's far end had.
    const kept = solver.entity(entity.id);
    if (kept === undefined) return Result.err("Unknown sketch entity");
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [farEnd(kept), { entityId: newId, pointIndex: originEnd(kept).pointIndex }],
    });
    return Result.ok({ entityIds: [entity.id, newId], removedConstraints: dropped, deletedEntities: [] });
}

/**
 * Cuts a circle in two at the two points, leaving two arcs where one closed curve was: the
 * circle is retyped into the first arc (keeping its id and its centre, so its dimensions
 * stay put) and the second is added, then three constraints hold them together — a
 * coincidence at each rim point and one between the centres, plus the equal radius over the
 * pair. That last one is what keeps the two halves a *circle*: with the centres shared but
 * each arc holding its own radius, they would drift apart under a drag — the two arcs, the
 * two rim joints and the shared centre come to one degree of freedom *more* than the circle
 * they replaced, and the free radius is exactly it.
 */
function carveCircle(
    solver: SketchSolver,
    circle: SketchEntityData,
    cuts: readonly [number, number][],
): Result<BreakOutcome> {
    const params = circle.params;
    const retyped = solver.retypeEntity(
        circle.id,
        "arc",
        [params[0], params[1], cuts[0][0], cuts[0][1], cuts[1][0], cuts[1][1]],
        (constraint) => circleToArcConstraint(solver, constraint, circle.id),
    );
    if (!retyped.isOk) return Result.err(retyped.error);

    const second = solver.addArc(params[0], params[1], cuts[1][0], cuts[1][1], cuts[0][0], cuts[0][1]);
    if (solver.isConstruction(circle.id)) solver.setConstruction(second, true);
    tieCarvedHalves(
        solver,
        circle.id,
        second,
        [
            [2, 1],
            [1, 2],
        ],
        [0],
    );
    solver.addConstraint(equalArcRadiusBetween(circle.id, second));
    return Result.ok({
        entityIds: [circle.id, second],
        removedConstraints: retyped.value,
        deletedEntities: [],
    });
}

/**
 * Holds a carved closed curve's two halves together: a coincidence where each cut met the
 * rim, and one per point index the halves share counting from 0 — an arc's centre, an
 * ellipse's centre and two axis points. That is what makes the two one curve rather than
 * two arcs that happen to touch.
 */
function tieCarvedHalves(
    solver: SketchSolver,
    keptId: number,
    secondId: number,
    rim: readonly (readonly [number, number])[],
    frame: readonly number[],
): void {
    const joints: (readonly [number, number])[] = [
        ...rim,
        ...frame.map((index): [number, number] => [index, index]),
    ];
    for (const [keptIndex, secondIndex] of joints) {
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: keptId, pointIndex: keptIndex },
                { entityId: secondId, pointIndex: secondIndex },
            ],
        });
    }
}

/**
 * Cuts an ellipse in two at the two points, leaving two ellipseArcs where one closed
 * curve was — the circle's own carve one frame richer. The ellipse is retyped into the
 * first arc (keeping its id and its frame, so its dimensions stay put) and the second is
 * added; the two rim coincidences join the halves, and three more pin their ellipse
 * frames point by point — the EqualArcRadius of the circle case has no ellipse reading,
 * so the shared centre and the two shared axis points are what keep the halves one
 * ellipse under a drag.
 */
function carveEllipse(
    solver: SketchSolver,
    ellipse: SketchEntityData,
    cuts: readonly [number, number][],
): Result<BreakOutcome> {
    const frame = ellipse.params.slice(0, 6);
    const retyped = solver.retypeEntity(
        ellipse.id,
        "ellipseArc",
        [...frame, cuts[0][0], cuts[0][1], cuts[1][0], cuts[1][1]],
        (constraint) => ellipseToArcConstraint(solver, constraint, ellipse.id),
    );
    if (!retyped.isOk) return Result.err(retyped.error);

    // the second half shares the frame and takes the cut points the other way round
    const second = solver.addEntityFromParams("ellipseArc", [
        ...frame,
        cuts[1][0],
        cuts[1][1],
        cuts[0][0],
        cuts[0][1],
    ]);
    if (solver.isConstruction(ellipse.id)) solver.setConstruction(second, true);
    // each arc's end onto the other's start, and one ellipse frame between the halves
    tieCarvedHalves(
        solver,
        ellipse.id,
        second,
        [
            [4, 3],
            [3, 4],
        ],
        [0, 1, 2],
    );
    return Result.ok({
        entityIds: [ellipse.id, second],
        removedConstraints: retyped.value,
        deletedEntities: [],
    });
}
