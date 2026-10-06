// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
import {
    entityLength,
    entityRadiusOf,
    farEnd,
    normalizeAngle,
    originEnd,
    parameterAt,
    pointAt,
} from "./curveGeometry";
import {
    addFarHalf,
    circleToArcConstraint,
    type EditOutcome,
    equalArcRadiusBetween,
    guardedEdit,
    migrateConstraints,
} from "./entityEditOps";
import { ConstraintKind, type SketchEntityData } from "./sketchModel";
import type { SketchSolver } from "./solver";
import { centerRef } from "./solverEntities";

/**
 * The sketch break: the entity is carved in two at the click, and the two halves are held
 * together by a coincidence at the cut — the shape Fusions' "Break", FreeCAD's "Split edge"
 * and Onshape's "Split" all leave, and what makes the new point a real vertex that can be
 * constrained, dimensioned or dragged rather than a mere drawing artefact.
 *
 * A line and an arc take one click, anywhere along them that is not one of their own ends.
 * A circle takes two: a closed curve has no ends to cut from, so a single cut would leave
 * the same closed curve with a seam on it and nothing carved — Onshape's own rule for
 * closed curves, and the reason the command asks for a second point before it commits.
 *
 * The op is a plan and its application, on `trimOps`' terms: the plan is pure geometry, the
 * application is direct solver mutation, and `guardedEdit` rolls the whole thing back on any
 * failure. The caller solves and commits afterwards.
 */

/** What a break leaves behind (see `EditOutcome`). */
export type BreakOutcome = EditOutcome;

/**
 * Carves `entityId` at the clicked points. `uvs` is one position for a line or an arc and
 * two for a circle; each is projected onto the entity, so a click near the curve still cuts
 * on it. The half holding the entity's origin keeps its id — the same choice the trim's
 * split makes — so its dimension anchors stay put.
 */
export function breakEntity(
    solver: SketchSolver,
    entityId: number,
    uvs: readonly [number, number][],
    tolerance: number,
): Result<BreakOutcome> {
    const tol = Math.max(tolerance, 1e-6);
    const entity = solver.entity(entityId);
    if (entity === undefined) return Result.err("Unknown sketch entity");
    // the datum and the external references are reference geometry: they cut, but they
    // are never cut up
    if (solver.isFixed(entityId)) {
        return Result.err("The datum and external references cannot be broken");
    }
    const cuts = planCuts(entity, uvs, tol);
    if (!cuts.isOk) return Result.err(cuts.error);
    return guardedEdit(solver, "the break", () =>
        entity.type === "circle"
            ? carveCircle(solver, entity, cuts.value)
            : Result.ok(carve(solver, entity, cuts.value[0])),
    );
}

/**
 * The points a break under the same clicks would cut at, in sketch terms; empty where it
 * would refuse. The editor draws these under the cursor while the pick is up, so the cut is
 * visible before it is made — the circle's two points included, which is why the command
 * hands back the one it already has.
 *
 * A circle's preview stops short of the two-arc test the op applies: the marker has to stay
 * on screen while the user moves to the second point, and refusing there would blank the
 * very cue they are aiming with. That refusal surfaces on the click instead.
 */
export function breakPreview(
    solver: SketchSolver,
    entityId: number,
    uvs: readonly [number, number][],
    tolerance: number,
): [number, number][] {
    const entity = solver.entity(entityId);
    if (entity === undefined || solver.isFixed(entityId)) return [];
    const tol = Math.max(tolerance, 1e-6);
    if (entity.type === "circle") return uvs.slice(0, 2).map((uv) => projected(entity, uv));
    if (uvs.length === 0) return [];
    return atOwnEnd(entity, uvs[0], tol) ? [] : [projected(entity, uvs[0])];
}

/** Every cut a break would make, or why it refuses. */
function planCuts(
    entity: SketchEntityData,
    uvs: readonly [number, number][],
    tolerance: number,
): Result<[number, number][]> {
    if (entity.type !== "circle") {
        if (uvs.length === 0) return Result.err("Pick a point along the entity");
        if (atOwnEnd(entity, uvs[0], tolerance)) {
            return Result.err("Pick a point along the entity, not one of its ends");
        }
        return Result.ok([projected(entity, uvs[0])]);
    }
    if (uvs.length < 2) return Result.err("A circle needs a second point to break at");
    const cuts: [number, number][] = [projected(entity, uvs[0]), projected(entity, uvs[1])];
    const sweeps = circleSweeps(entity, cuts[0], cuts[1]);
    if (sweeps.some((sweep) => sweep <= Precision.Angle || sweep >= Math.PI * 2 - Precision.Angle)) {
        return Result.err("Pick two points further apart along the circle");
    }
    return Result.ok(cuts);
}

/** Whether the click sits at (or within the tolerance of) one of the entity's own ends. */
function atOwnEnd(entity: SketchEntityData, uv: [number, number], tolerance: number): boolean {
    const s = parameterAt(entity, uv);
    return s <= tolerance || s >= entityLength(entity) - tolerance;
}

/** The click projected onto the entity: the cut lands on the curve, not beside it. */
function projected(entity: SketchEntityData, uv: [number, number]): [number, number] {
    return pointAt(entity, parameterAt(entity, uv));
}

/** The two sweeps, in radians, a circle cut at `first` and `second` would leave behind. */
function circleSweeps(
    circle: SketchEntityData,
    first: [number, number],
    second: [number, number],
): [number, number] {
    const radius = entityRadiusOf(circle);
    const forward = normalizeAngle((parameterAt(circle, second) - parameterAt(circle, first)) / radius);
    return [forward, Math.PI * 2 - forward];
}

// ------------------------------------------------------------------ Carving an entity

/**
 * Cuts a line or an arc in two at `point`: the entity keeps its id and its origin end, the
 * far half is added, and the endpoint they now share is pinned to the other half — the joint
 * the trim's split gets for free from the cutter it pins both ends to, which a break has to
 * state outright because nothing cut it.
 *
 * Nothing is dropped: the far end keeps its identity, so its constraints follow it onto the
 * new half, and the ones spanning the cut still read the points they always read.
 */
function carve(solver: SketchSolver, entity: SketchEntityData, point: [number, number]): BreakOutcome {
    const far = farEnd(entity);
    const farPoint = solver.pointOf(far);
    solver.setPointPosition(far, point[0], point[1]);

    const newId = addFarHalf(solver, entity, point, farPoint);
    migrateConstraints(solver, entity, far, newId);
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [far, { entityId: newId, pointIndex: originEnd(entity).pointIndex }],
    });
    return { entityIds: [entity.id, newId], removedConstraints: [], deletedEntities: [] };
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
    const halves = [circle.id, second];
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: circle.id, pointIndex: 2 },
            { entityId: second, pointIndex: 1 },
        ],
    });
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: circle.id, pointIndex: 1 },
            { entityId: second, pointIndex: 2 },
        ],
    });
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [centerRef(circle.id), centerRef(second)],
    });
    solver.addConstraint(equalArcRadiusBetween(halves[0], halves[1]));
    return Result.ok({
        entityIds: halves,
        removedConstraints: retyped.value,
        deletedEntities: [],
    });
}
