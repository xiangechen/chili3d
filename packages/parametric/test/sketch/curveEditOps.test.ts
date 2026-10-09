// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { type BreakOutcome, breakEntity, breakPreview } from "../../src/sketch/breakOps";
import {
    ellipseSweep,
    entityDomain,
    evaluateBezier,
    evaluateEllipse,
    evaluateEntity,
    nurbsSpec,
    projectPoint,
} from "../../src/sketch/curveEval";
import type { CurvePiece } from "../../src/sketch/curveGeometry";
import {
    type ExtendOptions,
    type ExtendOutcome,
    extendEntity,
    extendPreview,
} from "../../src/sketch/extendOps";
import { type MirrorOutcome, mirrorEntities, mirrorPreview, reflectPoint } from "../../src/sketch/mirrorOps";
import { offsetEntities } from "../../src/sketch/offsetOps";
import {
    ConstraintKind,
    defaultNurbsSpec,
    SKETCH_X_AXIS_ID,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import {
    type SketchTransform,
    type TransformOutcome,
    transformBase,
    transformEntities,
    transformPreview,
} from "../../src/sketch/transformOps";
import { type TrimOutcome, trimEntity, trimPreview } from "../../src/sketch/trimOps";
import "./setup";

const TOLERANCE = 1e-6;

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

function entityOf(solver: SketchSolver, id: number): SketchEntityData {
    const entity = solver.entity(id);
    expect(entity).toBeDefined();
    return entity!;
}

/** Params rounded to the sketch's own working precision, with −0 normalized away. */
function roundParams(params: readonly number[]): number[] {
    return params.map((value) => Math.round(value * 1e6) / 1e6 + 0);
}

function paramsOf(solver: SketchSolver, id: number): number[] {
    return roundParams(entityOf(solver, id).params);
}

function constraintsOf(solver: SketchSolver, kind: ConstraintKind): SketchConstraintData[] {
    return solver.toData().constraints.filter((constraint) => constraint.kind === kind);
}

/** A constraint's refs as [entityId, pointIndex] pairs, for toEqual. */
function refPairs(constraint: SketchConstraintData): number[][] {
    return constraint.refs.map((r) => [r.entityId, r.pointIndex]);
}

const near = (actual: number, expected: number, tolerance = 1e-9) => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

function nearPoint(actual: readonly number[], expected: readonly [number, number], tolerance = 1e-9): void {
    near(actual[0], expected[0], tolerance);
    near(actual[1], expected[1], tolerance);
}

/** The drawn middle of an ellipseArc: its sweep's mid-parameter point. */
function midArcOf(solver: SketchSolver, id: number): [number, number] {
    const params = entityOf(solver, id).params;
    const [start, end] = ellipseSweep(params);
    return evaluateEllipse(params, (start + end) / 2);
}

/** The leading point params of an entity as [u, v] pairs (a conic's rho trails them). */
function polesOf(params: readonly number[], count: number): [number, number][] {
    const poles: [number, number][] = [];
    for (let i = 0; i < count; i++) {
        poles.push([params[i * 2], params[i * 2 + 1]]);
    }
    return poles;
}

function polylinePointsOf(piece: CurvePiece): readonly [number, number][] {
    expect(piece.kind).toBe("polyline");
    if (piece.kind !== "polyline") throw new Error("expected a sampled polyline piece");
    return piece.points;
}

function expectCleanSolve(solver: SketchSolver): void {
    const diagnostics = solver.diagnose();
    expect(diagnostics.conflicting).toEqual([]);
    expect(diagnostics.redundant).toEqual([]);
}

function mirrored(solver: SketchSolver, ids: number[], axisId: number): MirrorOutcome {
    const result = mirrorEntities(solver, ids, axisId, TOLERANCE);
    if (!result.isOk) throw new Error(`the mirror was refused: ${result.error}`);
    return result.value;
}

function transformed(
    solver: SketchSolver,
    ids: number[],
    base: [number, number],
    transform: SketchTransform,
): TransformOutcome {
    const result = transformEntities(solver, ids, base, transform);
    if (!result.isOk) throw new Error(`the transform was refused: ${result.error}`);
    return result.value;
}

function trimmed(solver: SketchSolver, entityId: number, uv: [number, number]): TrimOutcome {
    const result = trimEntity(solver, entityId, uv, TOLERANCE);
    if (!result.isOk) throw new Error(`the trim was refused: ${result.error}`);
    return result.value;
}

function extended(solver: SketchSolver, options: ExtendOptions): ExtendOutcome {
    const result = extendEntity(solver, options);
    if (!result.isOk) throw new Error(`the extend was refused: ${result.error}`);
    return result.value;
}

function brokenAt(solver: SketchSolver, entityId: number, uvs: [number, number][]): BreakOutcome {
    const result = breakEntity(solver, entityId, uvs, TOLERANCE);
    if (!result.isOk) throw new Error(`the break was refused: ${result.error}`);
    return result.value;
}

describe("mirrorEntities on the curve families", () => {
    test("mirrors a conic across a datum axis, keeping rho, tied by symmetries and a ConicRho datum", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addConic(0, 0, 4, 8, 10, 0, 0.3);

            const preview = mirrorPreview(solver, [source], SKETCH_X_AXIS_ID, TOLERANCE);
            expect(preview).toHaveLength(1);
            expect(preview[0].type).toBe("conic");
            expect(roundParams(preview[0].params)).toEqual([0, 0, 4, -8, 10, 0, 0.3]);

            const outcome = mirrored(solver, [source], SKETCH_X_AXIS_ID);
            expect(outcome.skippedSelfMirror).toEqual([]);
            expect(outcome.createdEntityIds).toHaveLength(1);
            const copy = outcome.createdEntityIds[0];
            expect(entityOf(solver, copy).type).toBe("conic");
            expect(paramsOf(solver, copy)).toEqual([0, 0, 4, -8, 10, 0, 0.3]);

            const ties = constraintsOf(solver, ConstraintKind.Symmetric);
            expect(ties).toHaveLength(3);
            expect(ties.map((tie) => [tie.refs[0].pointIndex, tie.refs[1].pointIndex])).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
            ]);
            for (const tie of ties) {
                expect(tie.refs[0].entityId).toBe(source);
                expect(tie.refs[1].entityId).toBe(copy);
                expect(tie.refs[2].entityId).toBe(SKETCH_X_AXIS_ID);
                expect(tie.refs[3].entityId).toBe(SKETCH_X_AXIS_ID);
            }
            const rhoTies = constraintsOf(solver, ConstraintKind.ConicRho);
            expect(rhoTies).toHaveLength(1);
            expect(refPairs(rhoTies[0])).toEqual([[copy, 0]]);
            expect(rhoTies[0].datum).toBeCloseTo(0.3, 12);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("the conic copy follows the source's poles across the axis", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addConic(0, 0, 4, 8, 10, 0, 0.3);
            const copy = mirrored(solver, [source], SKETCH_X_AXIS_ID).createdEntityIds[0];

            solver.setPointPosition(ref(source, 1), 5, 9);
            solver.solve(true);

            const sourceParams = paramsOf(solver, source);
            const copyParams = paramsOf(solver, copy);
            // only the dragged pole's pair moved: the start and end stay put
            expect(sourceParams.slice(0, 2)).toEqual([0, 0]);
            expect(sourceParams.slice(4, 6)).toEqual([10, 0]);
            // every copy point is the reflection of its source point, rho included
            for (let pointIndex = 0; pointIndex < 3; pointIndex++) {
                nearPoint(copyParams.slice(pointIndex * 2, pointIndex * 2 + 2), [
                    sourceParams[pointIndex * 2],
                    -sourceParams[pointIndex * 2 + 1],
                ]);
            }
            expect(copyParams[6]).toBe(0.3);
            // and the copy genuinely moved: its control pole no longer sits at the mirrored (4, -8)
            expect(Math.hypot(copyParams[2] - 4, copyParams[3] + 8)).toBeGreaterThan(0.1);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors a bezier pole by pole, order preserved", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addBezier([0, 0, 2, 4, 6, 4, 8, 0]);

            const outcome = mirrored(solver, [source], SKETCH_X_AXIS_ID);

            const copy = outcome.createdEntityIds[0];
            expect(entityOf(solver, copy).type).toBe("bezier");
            expect(paramsOf(solver, copy)).toEqual([0, 0, 2, -4, 6, -4, 8, 0]);
            const ties = constraintsOf(solver, ConstraintKind.Symmetric);
            expect(ties).toHaveLength(4);
            expect(ties.map((tie) => [tie.refs[0].pointIndex, tie.refs[1].pointIndex])).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
                [3, 3],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("skips a bezier the axis already mirrors onto itself", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // every pole on the axis: the reflection would land the entity on itself
            const flat = solver.addBezier([0, 0, 3, 0, 6, 0, 8, 0]);

            expect(mirrorPreview(solver, [flat], SKETCH_X_AXIS_ID, TOLERANCE)).toEqual([]);
            const result = mirrorEntities(solver, [flat], SKETCH_X_AXIS_ID, TOLERANCE);
            expect(result.isOk).toBe(true);
            if (!result.isOk) throw new Error("unreachable");
            expect(result.value.createdEntityIds).toEqual([]);
            expect(result.value.skippedSelfMirror).toEqual([flat]);
            expect(solver.entities()).toHaveLength(1);
            expect(paramsOf(solver, flat)).toEqual([0, 0, 3, 0, 6, 0, 8, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors a nurbs control pole by pole, its weights and knots carried along", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addNurbs([0, 0, 2, 4, 6, 4, 8, 0], defaultNurbsSpec(4));

            const outcome = mirrored(solver, [source], SKETCH_X_AXIS_ID);

            const copy = outcome.createdEntityIds[0];
            expect(entityOf(solver, copy).type).toBe("nurbs");
            // only the control poles are reflected; the unit weights ride behind them and the
            // construction constants (degree, knots) are the source's own
            expect(paramsOf(solver, copy)).toEqual([0, 0, 2, -4, 6, -4, 8, 0, 1, 1, 1, 1]);
            expect(entityOf(solver, copy).nurbs).toEqual(defaultNurbsSpec(4));
            const ties = constraintsOf(solver, ConstraintKind.Symmetric);
            expect(ties).toHaveLength(4);
            expect(ties.map((tie) => [tie.refs[0].pointIndex, tie.refs[1].pointIndex])).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
                [3, 3],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors an ellipse across a mirror line, frame tied point by point", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addEllipse(0, 0, 4, 0, 0, 2);
            const axis = solver.addLine(10, -10, 10, 20);

            const preview = mirrorPreview(solver, [source], axis, TOLERANCE);
            expect(preview).toHaveLength(1);
            expect(preview[0].type).toBe("ellipse");
            expect(preview[0].params).toEqual([20, 0, 16, 0, 20, 2]);

            const outcome = mirrored(solver, [source], axis);
            expect(outcome.skippedSelfMirror).toEqual([]);
            const copy = outcome.createdEntityIds[0];
            expect(entityOf(solver, copy).type).toBe("ellipse");
            expect(paramsOf(solver, copy)).toEqual([20, 0, 16, 0, 20, 2]);

            const ties = constraintsOf(solver, ConstraintKind.Symmetric);
            expect(ties).toHaveLength(3);
            expect(ties.map((tie) => [tie.refs[0].pointIndex, tie.refs[1].pointIndex])).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
            ]);
            for (const tie of ties) {
                expect(tie.refs[0].entityId).toBe(source);
                expect(tie.refs[1].entityId).toBe(copy);
                expect(tie.refs[2].entityId).toBe(axis);
                expect(tie.refs[3].entityId).toBe(axis);
            }
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("the ellipse copy follows the source's frame across the axis", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addEllipse(0, 0, 4, 0, 0, 2);
            const axis = solver.addLine(10, -10, 10, 20);
            const copy = mirrored(solver, [source], axis).createdEntityIds[0];

            solver.setPointPosition(ref(source, 1), 5, 1);
            expect(solver.solve(true).result).toBe("OkUnderconstrained");

            const sourceParams = entityOf(solver, source).params;
            const copyParams = entityOf(solver, copy).params;
            const axisParams = entityOf(solver, axis).params;
            const a: [number, number] = [axisParams[0], axisParams[1]];
            const b: [number, number] = [axisParams[2], axisParams[3]];
            // the solve is least-norm, so the axis and the source's other frame points move
            // too — the tie is asserted against wherever the axis settled
            for (let pointIndex = 0; pointIndex < 3; pointIndex++) {
                nearPoint(
                    copyParams.slice(pointIndex * 2, pointIndex * 2 + 2),
                    reflectPoint([sourceParams[pointIndex * 2], sourceParams[pointIndex * 2 + 1]], a, b),
                );
            }
            // the copy genuinely moved: its centre no longer sits at the mirrored (20, 0)
            expect(Math.hypot(copyParams[0] - 20, copyParams[1])).toBeGreaterThan(0.01);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors an ellipseArc across a mirror line, rims reflected in place", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the top-right quarter of the 4×2 ellipse: sweep [0, π/2]
            const source = solver.addEllipseArc(0, 0, 4, 0, 0, 2, 4, 0, 0, 2);
            const axis = solver.addLine(10, -10, 10, 20);

            const preview = mirrorPreview(solver, [source], axis, TOLERANCE);
            expect(preview).toHaveLength(1);
            expect(preview[0].type).toBe("ellipseArc");
            expect(preview[0].params).toEqual([20, 0, 16, 0, 20, 2, 16, 0, 20, 2]);

            const outcome = mirrored(solver, [source], axis);
            expect(outcome.skippedSelfMirror).toEqual([]);
            const copy = outcome.createdEntityIds[0];
            expect(entityOf(solver, copy).type).toBe("ellipseArc");
            // the mirrored frame is left-handed and carries the orientation flip itself,
            // so the rims are reflected in place — NOT swapped (a swap would draw the
            // complementary three-quarter arc)
            expect(paramsOf(solver, copy)).toEqual([20, 0, 16, 0, 20, 2, 16, 0, 20, 2]);

            // all five points — frame and rims — are tied across the axis
            const ties = constraintsOf(solver, ConstraintKind.Symmetric);
            expect(ties).toHaveLength(5);
            expect(ties.map((tie) => [tie.refs[0].pointIndex, tie.refs[1].pointIndex])).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
                [3, 3],
                [4, 4],
            ]);
            for (const tie of ties) {
                expect(tie.refs[0].entityId).toBe(source);
                expect(tie.refs[1].entityId).toBe(copy);
                expect(tie.refs[2].entityId).toBe(axis);
                expect(tie.refs[3].entityId).toBe(axis);
            }

            // the copy draws the reflection: the same quarter-width sweep, and its
            // mid-arc point is the source's mid-arc point reflected across the axis
            const [start, end] = ellipseSweep(entityOf(solver, copy).params);
            near(end - start, Math.PI / 2);
            nearPoint(midArcOf(solver, copy), [20 - 2 * Math.SQRT2, Math.SQRT2]);
            nearPoint(midArcOf(solver, copy), reflectPoint(midArcOf(solver, source), [10, -10], [10, 20]));
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("the ellipseArc copy follows the source across the axis, rims included", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addEllipseArc(0, 0, 4, 0, 0, 2, 4, 0, 0, 2);
            const axis = solver.addLine(10, -10, 10, 20);
            const copy = mirrored(solver, [source], axis).createdEntityIds[0];

            solver.setPointPosition(ref(source, 1), 5, 1);
            expect(solver.solve(true).result).toBe("OkUnderconstrained");

            // the solve is least-norm, so the axis and the source's other points move
            // too — every one of the five points (frame and rims) is checked against
            // wherever the axis settled
            const sourceParams = entityOf(solver, source).params;
            const copyParams = entityOf(solver, copy).params;
            const axisParams = entityOf(solver, axis).params;
            const a: [number, number] = [axisParams[0], axisParams[1]];
            const b: [number, number] = [axisParams[2], axisParams[3]];
            for (let pointIndex = 0; pointIndex < 5; pointIndex++) {
                nearPoint(
                    copyParams.slice(pointIndex * 2, pointIndex * 2 + 2),
                    reflectPoint([sourceParams[pointIndex * 2], sourceParams[pointIndex * 2 + 1]], a, b),
                );
            }
            // the copy genuinely moved: its centre no longer sits at the mirrored (20, 0)
            expect(Math.hypot(copyParams[0] - 20, copyParams[1])).toBeGreaterThan(0.01);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("skips an ellipse the axis already mirrors onto itself", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the axis runs through the centre along a frame axis: the reflection maps
            // the ellipse onto itself (its minor frame point flips sign, same curve)
            const ellipse = solver.addEllipse(5, 2, 5, 6, 9, 2);
            const axis = solver.addLine(5, -10, 5, 10);

            const outcome = mirrored(solver, [ellipse], axis);

            expect(outcome.createdEntityIds).toEqual([]);
            expect(outcome.skippedSelfMirror).toEqual([ellipse]);
            expect(solver.toData().entities).toHaveLength(2);
            expect(paramsOf(solver, ellipse)).toEqual([5, 2, 5, 6, 9, 2]);
        } finally {
            solver.dispose();
        }
    });

    test("skips an ellipseArc symmetric about the mirror axis", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the axis is the ellipse's major axis, and the rims sit at t = ±π/3 —
            // mirror images of each other — so the drawn arc maps onto itself
            const arc = solver.addEllipseArc(5, 0, 13, 0, 5, 6, 9, 3 * Math.sqrt(3), 9, -3 * Math.sqrt(3));
            const axis = solver.addLine(-10, 0, 10, 0);

            const outcome = mirrored(solver, [arc], axis);

            expect(outcome.createdEntityIds).toEqual([]);
            expect(outcome.skippedSelfMirror).toEqual([arc]);
            expect(solver.toData().entities).toHaveLength(2);
            expect(roundParams(entityOf(solver, arc).params.slice(0, 6))).toEqual([5, 0, 13, 0, 5, 6]);
            nearPoint(entityOf(solver, arc).params.slice(6, 8), [9, 3 * Math.sqrt(3)], 1e-6);
            nearPoint(entityOf(solver, arc).params.slice(8, 10), [9, -3 * Math.sqrt(3)], 1e-6);
        } finally {
            solver.dispose();
        }
    });

    test("mirrors an ellipseArc that is only frame-symmetric about the axis", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // same axis, same ellipse — but the quarter arc [0, π/2] is not symmetric
            // about it, so it must be mirrored, not skipped
            const source = solver.addEllipseArc(5, 0, 13, 0, 5, 6, 13, 0, 5, 6);
            const axis = solver.addLine(-10, 0, 10, 0);

            const outcome = mirrored(solver, [source], axis);

            expect(outcome.skippedSelfMirror).toEqual([]);
            const copy = outcome.createdEntityIds[0];
            expect(entityOf(solver, copy).type).toBe("ellipseArc");
            expect(paramsOf(solver, copy)).toEqual([5, 0, 13, 0, 5, -6, 13, 0, 5, -6]);
            // the drawn quarter lands below the axis: the copy's mid-arc point is the
            // source's reflected
            const [start, end] = ellipseSweep(entityOf(solver, copy).params);
            near(end - start, Math.PI / 2);
            nearPoint(midArcOf(solver, copy), [5 + 4 * Math.SQRT2, -3 * Math.SQRT2]);
            nearPoint(midArcOf(solver, copy), reflectPoint(midArcOf(solver, source), [-10, 0], [10, 0]));
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("skips a bezier whose poles reflect pairwise in reverse order", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // p0 ↔ p3 and p1 ↔ p2 are mirror images across the axis: the reflected pole
            // list is the reversed one, and a reversed cubic re-traces the same curve
            const bezier = solver.addBezier([0, 0, 1, 4, 9, 4, 10, 0]);
            const axis = solver.addLine(5, -10, 5, 10);

            const outcome = mirrored(solver, [bezier], axis);

            expect(outcome.createdEntityIds).toEqual([]);
            expect(outcome.skippedSelfMirror).toEqual([bezier]);
            expect(solver.toData().entities).toHaveLength(2);
            expect(paramsOf(solver, bezier)).toEqual([0, 0, 1, 4, 9, 4, 10, 0]);
        } finally {
            solver.dispose();
        }
    });
});

describe("transformEntities on the curve families", () => {
    test("scales and shifts a conic about the base, leaving rho alone", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const conic = solver.addConic(0, 0, 4, 8, 10, 0, 0.3);
            const transform = { du: 1, dv: 2, angle: 0, scale: 1.5 };

            const preview = transformPreview(solver, [conic], [0, 0], transform);
            expect(preview).toHaveLength(1);
            expect(preview[0].type).toBe("conic");
            expect(preview[0].params).toEqual([1, 2, 7, 14, 16, 2, 0.3]);

            const outcome = transformed(solver, [conic], [0, 0], transform);
            expect(outcome.movedEntityIds).toEqual([conic]);
            expect(outcome.removedConstraintIds).toEqual([]);
            expect(outcome.swappedConstraintIds).toEqual([]);
            expect(paramsOf(solver, conic)).toEqual([1, 2, 7, 14, 16, 2, 0.3]);
        } finally {
            solver.dispose();
        }
    });

    test("rotates a bezier about the base pole by pole", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 2, 4, 6, 4, 8, 0]);

            // a quarter turn about the origin, then a shift: (u, v) → (1 − v, u + 2)
            const outcome = transformed(solver, [bezier], [0, 0], {
                du: 1,
                dv: 2,
                angle: Math.PI / 2,
                scale: 1,
            });

            expect(outcome.movedEntityIds).toEqual([bezier]);
            expect(paramsOf(solver, bezier)).toEqual([1, 2, -3, 4, -3, 8, 1, 10]);
        } finally {
            solver.dispose();
        }
    });

    test("rotates a nurbs about the base, its weights and knots untouched", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const nurbs = solver.addNurbs([0, 0, 2, 4, 6, 4, 8, 0], defaultNurbsSpec(4));

            // the same quarter turn and shift as the bezier: nothing but the control poles moves
            const outcome = transformed(solver, [nurbs], [0, 0], {
                du: 1,
                dv: 2,
                angle: Math.PI / 2,
                scale: 1,
            });

            expect(outcome.movedEntityIds).toEqual([nurbs]);
            expect(paramsOf(solver, nurbs)).toEqual([1, 2, -3, 4, -3, 8, 1, 10, 1, 1, 1, 1]);
            expect(entityOf(solver, nurbs).nurbs).toEqual(defaultNurbsSpec(4));
        } finally {
            solver.dispose();
        }
    });

    test("transformBase sits at the bounding-box centre of a mixed line and bezier selection", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 4, 0);
            // monotone poles, so the sampled bbox corners are the curve's own ends
            const bezier = solver.addBezier([10, 2, 11, 3, 13, 4, 14, 5]);

            expect(transformBase(solver, [line, bezier])).toEqual([7, 2.5]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a scale that would collapse a conic to a point", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const conic = solver.addConic(0, 0, 0.2, 0.4, 0.4, 0, 0.5);

            const result = transformEntities(solver, [conic], [0, 0], {
                du: 0,
                dv: 0,
                angle: 0,
                scale: 2e-7,
            });

            expect(result.isOk).toBe(false);
            if (result.isOk) throw new Error("unreachable");
            expect(result.error).toBe("The scale would collapse the sketch geometry");
            expect(paramsOf(solver, conic)).toEqual([0, 0, 0.2, 0.4, 0.4, 0, 0.5]);
        } finally {
            solver.dispose();
        }
    });

    test("scales and shifts an ellipse about the base, semi-axes and all", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const ellipse = solver.addEllipse(0, 0, 4, 0, 0, 2);
            const transform = { du: 1, dv: 2, angle: 0, scale: 1.5 };

            const preview = transformPreview(solver, [ellipse], [0, 0], transform);
            expect(preview).toHaveLength(1);
            expect(preview[0].type).toBe("ellipse");
            expect(preview[0].params).toEqual([1, 2, 7, 2, 1, 5]);

            const outcome = transformed(solver, [ellipse], [0, 0], transform);
            expect(outcome.movedEntityIds).toEqual([ellipse]);
            expect(outcome.removedConstraintIds).toEqual([]);
            expect(paramsOf(solver, ellipse)).toEqual([1, 2, 7, 2, 1, 5]);
            // the semi-axes scaled by the factor: 4 → 6 and 2 → 3, the frame still orthogonal
            const [cx, cy, mx, my, nx, ny] = entityOf(solver, ellipse).params;
            near(Math.hypot(mx - cx, my - cy), 6);
            near(Math.hypot(nx - cx, ny - cy), 3);
            near((mx - cx) * (nx - cx) + (my - cy) * (ny - cy), 0);
        } finally {
            solver.dispose();
        }
    });

    test("rotates an ellipseArc about the base, keeping its sweep", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the top-right quarter of the (20, 0)/4×2 ellipse: sweep [0, π/2]
            const arc = solver.addEllipseArc(20, 0, 24, 0, 20, 2, 24, 0, 20, 2);

            const outcome = transformed(solver, [arc], [20, 0], {
                du: 0,
                dv: 0,
                angle: Math.PI / 2,
                scale: 1,
            });

            expect(outcome.movedEntityIds).toEqual([arc]);
            expect(outcome.removedConstraintIds).toEqual([]);
            expect(outcome.swappedConstraintIds).toEqual([]);
            // a quarter turn about the centre: (u, v) → (20 − v, u)
            expect(paramsOf(solver, arc)).toEqual([20, 0, 20, 4, 18, 0, 20, 4, 18, 0]);
            const [start, end] = ellipseSweep(entityOf(solver, arc).params);
            near(end - start, Math.PI / 2);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a scale that would collapse an ellipse to a point", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const ellipse = solver.addEllipse(0, 0, 0.4, 0, 0, 0.2);

            const result = transformEntities(solver, [ellipse], [0, 0], {
                du: 0,
                dv: 0,
                angle: 0,
                scale: 2e-7,
            });

            expect(result.isOk).toBe(false);
            if (result.isOk) throw new Error("unreachable");
            expect(result.error).toBe("The scale would collapse the sketch geometry");
            expect(paramsOf(solver, ellipse)).toEqual([0, 0, 0.4, 0, 0, 0.2]);
        } finally {
            solver.dispose();
        }
    });
});

describe("trimEntity on the curve families", () => {
    // the conic is the unit-weight quadratic through (0, 0) and (10, 0): x = 10t, y = 20t(1 − t),
    // so the x = 2 and x = 8 cutters cross it at exactly (2, 3.2) and (8, 3.2)
    test("splits a conic at the crossings bracketing the click, reparametrizing both halves", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const conic = solver.addConic(0, 0, 5, 10, 10, 0, 0.5);
            const left = solver.addLine(2, -5, 2, 15);
            const right = solver.addLine(8, -5, 8, 15);

            const preview = trimPreview(solver, conic, [5, 5], TOLERANCE);
            expect(preview).toBeDefined();
            const removed = polylinePointsOf(preview!);
            expect(removed.length).toBeGreaterThan(2);
            // the drawn piece's ends ride the sampled-arclength inversion (parameterAtLength's
            // own note: the pieces drawn from it share the tolerance), so they sit within
            // ~1e-2 of the Newton-exact crossings the op itself cuts at — and the piece
            // passes through the click's neighbourhood
            nearPoint(removed[0], [2, 3.2], 1e-2);
            nearPoint(removed[removed.length - 1], [8, 3.2], 1e-2);
            nearPoint(removed[Math.floor(removed.length / 2)], [5, 5], 1e-2);

            const outcome = trimmed(solver, conic, [5, 5]);
            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(conic);
            expect(entityOf(solver, added).type).toBe("conic");
            // the kept half is t ∈ [0, 0.2] of the original, the added one t ∈ [0.8, 1]
            expect(paramsOf(solver, kept)).toEqual([0, 0, 1, 2, 2, 3.2, 0.5]);
            expect(paramsOf(solver, added)).toEqual([8, 3.2, 9, 2, 10, 0, 0.5]);

            const originalPoles: [number, number][] = [
                [0, 0],
                [5, 10],
                [10, 0],
            ];
            const weights = [1, 1, 1];
            const keptPoles = polesOf(entityOf(solver, kept).params, 3);
            const addedPoles = polesOf(entityOf(solver, added).params, 3);
            for (const u of [0.25, 0.5, 0.75]) {
                nearPoint(
                    evaluateBezier(keptPoles, u, weights),
                    evaluateBezier(originalPoles, 0.2 * u, weights),
                    1e-6,
                );
                nearPoint(
                    evaluateBezier(addedPoles, u, weights),
                    evaluateBezier(originalPoles, 0.8 + 0.2 * u, weights),
                    1e-6,
                );
            }

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(2);
            expect(refPairs(pins[0])).toEqual([
                [kept, 2],
                [left, 0],
                [left, 1],
            ]);
            expect(refPairs(pins[1])).toEqual([
                [added, 0],
                [right, 0],
                [right, 1],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // the cubic with these poles is the same arch: x = 10t, y = 20t(1 − t)
    test("splits a bezier at the crossings bracketing the click, reparametrizing both halves", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 10 / 3, 20 / 3, 20 / 3, 20 / 3, 10, 0]);
            const left = solver.addLine(2, -5, 2, 15);
            const right = solver.addLine(8, -5, 8, 15);

            const outcome = trimmed(solver, bezier, [5, 5]);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(bezier);
            expect(entityOf(solver, added).type).toBe("bezier");
            // a bezier split keeps the degree: both halves are four-pole beziers
            expect(paramsOf(solver, kept)).toEqual([0, 0, 0.666667, 1.333333, 1.333333, 2.4, 2, 3.2]);
            expect(paramsOf(solver, added)).toEqual([8, 3.2, 8.666667, 2.4, 9.333333, 1.333333, 10, 0]);

            const originalPoles: [number, number][] = [
                [0, 0],
                [10 / 3, 20 / 3],
                [20 / 3, 20 / 3],
                [10, 0],
            ];
            const keptPoles = polesOf(entityOf(solver, kept).params, 4);
            const addedPoles = polesOf(entityOf(solver, added).params, 4);
            for (const u of [0.25, 0.5, 0.75]) {
                nearPoint(evaluateBezier(keptPoles, u), evaluateBezier(originalPoles, 0.2 * u), 1e-6);
                nearPoint(evaluateBezier(addedPoles, u), evaluateBezier(originalPoles, 0.8 + 0.2 * u), 1e-6);
            }

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(2);
            expect(refPairs(pins[0])).toEqual([
                [kept, 3],
                [left, 0],
                [left, 1],
            ]);
            expect(refPairs(pins[1])).toEqual([
                [added, 0],
                [right, 0],
                [right, 1],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // the same arch as a NURBS: x = 10t, y = 20t(1 − t), its clamped knots giving the domain [0, 1]
    test("splits a nurbs at the crossings bracketing the click, knot insertion slicing both halves", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const nurbs = solver.addNurbs([0, 0, 10 / 3, 20 / 3, 20 / 3, 20 / 3, 10, 0], defaultNurbsSpec(4));
            const left = solver.addLine(2, -5, 2, 15);
            const right = solver.addLine(8, -5, 8, 15);

            const outcome = trimmed(solver, nurbs, [5, 5]);
            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(nurbs);
            expect(entityOf(solver, kept).type).toBe("nurbs");
            expect(entityOf(solver, added).type).toBe("nurbs");
            // the crossings land on the cut knots 0.2 and 0.8: each half is clamped there, its
            // four control poles the de Casteljau poles of the cut and its unit weights carried
            expect(paramsOf(solver, kept)).toEqual([
                0, 0, 0.666667, 1.333333, 1.333333, 2.4, 2, 3.2, 1, 1, 1, 1,
            ]);
            expect(paramsOf(solver, added)).toEqual([
                8, 3.2, 8.666667, 2.4, 9.333333, 1.333333, 10, 0, 1, 1, 1, 1,
            ]);
            const keptSpec = nurbsSpec(entityOf(solver, kept));
            const addedSpec = nurbsSpec(entityOf(solver, added));
            expect(keptSpec.degree).toBe(3);
            expect(roundParams(keptSpec.knots)).toEqual([0, 0, 0, 0, 0.2, 0.2, 0.2, 0.2]);
            expect(addedSpec.degree).toBe(3);
            expect(roundParams(addedSpec.knots)).toEqual([0.8, 0.8, 0.8, 0.8, 1, 1, 1, 1]);
            // the domain follows the cut: [0, 0.2] kept, [0.8, 1] added
            near(entityDomain(entityOf(solver, kept))[1], 0.2, 1e-6);
            near(entityDomain(entityOf(solver, added))[0], 0.8, 1e-6);

            // unlike a bezier the halves keep the original parametrization, so each piece at a
            // domain parameter is the original curve at that very parameter
            const originalPoles: [number, number][] = [
                [0, 0],
                [10 / 3, 20 / 3],
                [20 / 3, 20 / 3],
                [10, 0],
            ];
            for (const p of [0.05, 0.1, 0.15, 0.2]) {
                nearPoint(evaluateEntity(entityOf(solver, kept), p), evaluateBezier(originalPoles, p), 1e-6);
            }
            for (const p of [0.8, 0.85, 0.9, 0.95, 1]) {
                nearPoint(evaluateEntity(entityOf(solver, added), p), evaluateBezier(originalPoles, p), 1e-6);
            }

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(2);
            expect(refPairs(pins[0])).toEqual([
                [kept, 3],
                [left, 0],
                [left, 1],
            ]);
            expect(refPairs(pins[1])).toEqual([
                [added, 0],
                [right, 0],
                [right, 1],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });
    // the cutters cross the ellipse at exactly (3, √7/2) and (√7, 3/2); the click at its
    // t = π/4 point removes the small piece between them
    test("retypes an ellipse into the ellipseArc its kept side leaves behind", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const ellipse = solver.addEllipse(0, 0, 4, 0, 0, 2);
            const vertical = solver.addLine(3, -5, 3, 15);
            const horizontal = solver.addLine(-5, 1.5, 15, 1.5);
            const click: [number, number] = [2 * Math.SQRT2, Math.SQRT2];

            const preview = trimPreview(solver, ellipse, click, TOLERANCE);
            expect(preview).toBeDefined();
            const removed = polylinePointsOf(preview!);
            expect(removed.length).toBeGreaterThan(2);
            nearPoint(removed[0], [3, Math.sqrt(7) / 2], 1e-2);
            nearPoint(removed[removed.length - 1], [Math.sqrt(7), 1.5], 1e-2);

            const outcome = trimmed(solver, ellipse, click);
            expect(outcome.entityIds).toEqual([ellipse]);
            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);

            const kept = entityOf(solver, ellipse);
            expect(kept.type).toBe("ellipseArc");
            // the frame survives the retype; the rims are the two crossings
            expect(roundParams(kept.params.slice(0, 6))).toEqual([0, 0, 4, 0, 0, 2]);
            nearPoint(kept.params.slice(6, 8), [Math.sqrt(7), 1.5], 1e-6);
            nearPoint(kept.params.slice(8, 10), [3, Math.sqrt(7) / 2], 1e-6);

            // the kept sweep is everything but the clicked piece: its middle sits at the
            // click's antipode, and the clicked point is off the arc altogether
            const [start, end] = ellipseSweep(kept.params);
            nearPoint(evaluateEllipse(kept.params, (start + end) / 2), [-2 * Math.SQRT2, -Math.SQRT2], 1e-6);
            expect(projectPoint(kept, click).distance).toBeGreaterThan(0.1);

            // the rims ride on the ellipse structurally, and each is pinned to its cutter
            const perpendiculars = constraintsOf(solver, ConstraintKind.Perpendicular);
            expect(perpendiculars.map((c) => refPairs(c))).toEqual([
                [
                    [ellipse, 0],
                    [ellipse, 1],
                    [ellipse, 0],
                    [ellipse, 2],
                ],
            ]);
            const structural = constraintsOf(solver, ConstraintKind.PointOnEllipse);
            expect(structural.map((c) => refPairs(c))).toEqual([
                [
                    [ellipse, 3],
                    [ellipse, 0],
                ],
                [
                    [ellipse, 4],
                    [ellipse, 0],
                ],
            ]);
            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins.map((c) => refPairs(c))).toEqual([
                [
                    [ellipse, 3],
                    [horizontal, 0],
                    [horizontal, 1],
                ],
                [
                    [ellipse, 4],
                    [vertical, 0],
                    [vertical, 1],
                ],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });
});

describe("extendEntity on the curve families", () => {
    // the support of this bezier leaves (8, 8) straight up and crosses x = 0 again at exactly
    // (0, 18) — its t = 3/2 point — so the boundary meets it there
    test("extends a bezier's end along its support out to a line boundary", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 0, 4, 8, 4, 8, 8]);
            const boundary = solver.addLine(0, 10, 0, 20);
            const options: ExtendOptions = {
                targetId: bezier,
                targetUv: [8, 8],
                boundaryId: boundary,
                boundaryUv: [0, 17],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            expect(preview!).toHaveLength(1);
            expect(preview![0].role).toBe("add");
            const gained = polylinePointsOf(preview![0].piece);
            expect(gained.length).toBeGreaterThan(2);
            nearPoint(gained[0], [8, 8], 1e-2);
            nearPoint(gained[gained.length - 1], [0, 18], 1e-2);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([bezier]);
            expect(outcome.removedConstraints).toEqual([]);
            // the support piece out to the corner, reparametrized to [0, 1]: exact by de Casteljau
            expect(paramsOf(solver, bezier)).toEqual([0, 0, 0, 6, 18, 3, 0, 18]);
            expect(paramsOf(solver, boundary)).toEqual([0, 10, 0, 20]);

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(1);
            expect(refPairs(pins[0])).toEqual([
                [bezier, 3],
                [boundary, 0],
                [boundary, 1],
            ]);

            // the old span still traces the original curve: new(t / 1.5) == original(t)
            const originalPoles: [number, number][] = [
                [0, 0],
                [0, 4],
                [8, 4],
                [8, 8],
            ];
            const newPoles = polesOf(entityOf(solver, bezier).params, 4);
            for (const t of [0.2, 0.5, 0.8]) {
                nearPoint(evaluateBezier(newPoles, t / 1.5), evaluateBezier(originalPoles, t), 1e-6);
            }
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // weights [1, 1/3, 1]: reaching the boundary's support corner (the t = 2 point (100/11, −20/11))
    // would reparametrize the conic onto a negative middle weight — no standard form carries it
    test("refuses a corner beyond where a conic's support can reach, leaving the sketch untouched", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const conic = solver.addConic(0, 0, 5, 5, 10, 0, 0.25);
            const boundary = solver.addLine(100 / 11, -10, 100 / 11, 10);
            const options: ExtendOptions = {
                targetId: conic,
                targetUv: [9.8, 0.2],
                boundaryId: boundary,
                boundaryUv: [100 / 11, -1],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            expect(extendPreview(solver, options)).toBeUndefined();
            const result = extendEntity(solver, options);
            expect(result.isOk).toBe(false);
            if (result.isOk) throw new Error("unreachable");
            expect(result.error).toBe("The corner lies beyond where the curve can reach");
            expect(paramsOf(solver, conic)).toEqual([0, 0, 5, 5, 10, 0, 0.25]);
            expect(solver.toData().constraints).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    // the line y = 5 meets the (10, 0)/8×6 ellipse at x = 10 − 4√11/3, inside the
    // boundary's drawn quarter (t ≈ 2.157 ∈ [π/2, π])
    test("extends a line's end onto an ellipseArc boundary", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 5, 4, 5);
            const boundary = solver.addEllipseArc(10, 0, 18, 0, 10, 6, 10, 6, 2, 0);
            const corner: [number, number] = [10 - (4 * Math.sqrt(11)) / 3, 5];
            const options: ExtendOptions = {
                targetId: line,
                targetUv: [4, 5],
                boundaryId: boundary,
                boundaryUv: [5.6, 5],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            expect(preview!).toHaveLength(1);
            expect(preview![0].role).toBe("add");
            const piece = preview![0].piece;
            expect(piece.kind).toBe("line");
            if (piece.kind !== "line") throw new Error("expected a straight preview piece");
            nearPoint(piece.point1, [4, 5]);
            nearPoint(piece.point2, corner);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([line]);
            expect(outcome.removedConstraints).toEqual([]);
            const lineParams = entityOf(solver, line).params;
            expect(lineParams.slice(0, 2)).toEqual([0, 5]);
            nearPoint(lineParams.slice(2, 4), corner);
            // the boundary is untouched
            expect(paramsOf(solver, boundary)).toEqual([10, 0, 18, 0, 10, 6, 10, 6, 2, 0]);

            // the moved end is pinned onto the arc's ellipse — the two structural
            // rim incidences are the boundary's own
            const pins = constraintsOf(solver, ConstraintKind.PointOnEllipse);
            expect(pins.map((pin) => refPairs(pin))).toEqual([
                [
                    [boundary, 3],
                    [boundary, 0],
                ],
                [
                    [boundary, 4],
                    [boundary, 0],
                ],
                [
                    [line, 1],
                    [boundary, 0],
                ],
            ]);
            // and it lands on the drawn arc, not just on its ellipse
            near(projectPoint(entityOf(solver, boundary), corner).distance, 0);

            expect(solver.solve(true).result).toBe("OkUnderconstrained");
            expect(paramsOf(solver, boundary)).toEqual([10, 0, 18, 0, 10, 6, 10, 6, 2, 0]);
            nearPoint(entityOf(solver, line).params.slice(2, 4), corner);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // the collinear cubic x(t) = 9t − t³ ends at (8, 0), but its support line carries
    // on — the corner (8.2, 0) lies past the end on it, and a clamped end read would
    // refuse this extension
    test("extends a collinear bezier's end past its span onto a line boundary", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 3, 0, 6, 0, 8, 0]);
            const boundary = solver.addLine(8.2, -5, 8.2, 5);
            const options: ExtendOptions = {
                targetId: bezier,
                targetUv: [8, 0],
                boundaryId: boundary,
                boundaryUv: [8.2, 0],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            expect(preview!).toHaveLength(1);
            expect(preview![0].role).toBe("add");
            const gained = polylinePointsOf(preview![0].piece);
            expect(gained.length).toBeGreaterThan(2);
            nearPoint(gained[0], [8, 0], 1e-2);
            nearPoint(gained[gained.length - 1], [8.2, 0], 1e-2);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([bezier]);
            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);

            // reparametrized by de Casteljau to the corner's support parameter
            // u ≈ 1.0339: poles [0, 3u, 6u, 8.2] on the x-axis, the end pole on the boundary
            const newPoles = polesOf(entityOf(solver, bezier).params, 4);
            nearPoint(newPoles[0], [0, 0]);
            nearPoint(newPoles[3], [8.2, 0], 1e-6);
            for (const pole of newPoles) near(pole[1], 0);
            const u = newPoles[1][0] / 3;
            near(newPoles[2][0], 2 * newPoles[1][0]);
            near(9 * u - u ** 3, 8.2, 1e-5);
            expect(paramsOf(solver, boundary)).toEqual([8.2, -5, 8.2, 5]);

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(1);
            expect(refPairs(pins[0])).toEqual([
                [bezier, 3],
                [boundary, 0],
                [boundary, 1],
            ]);

            // the old span still traces the original segment: new(t / u) == original(t)
            const originalPoles: [number, number][] = [
                [0, 0],
                [3, 0],
                [6, 0],
                [8, 0],
            ];
            for (const t of [0.2, 0.5, 0.8]) {
                nearPoint(evaluateBezier(newPoles, t / u), evaluateBezier(originalPoles, t), 1e-5);
            }

            expect(solver.solve(true).result).toBe("OkUnderconstrained");
            nearPoint(polesOf(entityOf(solver, bezier).params, 4)[3], [8.2, 0], 1e-6);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a corner the bezier already reaches, leaving the sketch untouched", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 3, 0, 6, 0, 8, 0]);
            const boundary = solver.addLine(8, -5, 8, 5);
            const options: ExtendOptions = {
                targetId: bezier,
                targetUv: [8, 0],
                boundaryId: boundary,
                boundaryUv: [8, 0.5],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            expect(extendPreview(solver, options)).toBeUndefined();
            const result = extendEntity(solver, options);
            expect(result.isOk).toBe(false);
            if (result.isOk) throw new Error("unreachable");
            expect(result.error).toBe("The entity already reaches the corner");
            expect(paramsOf(solver, bezier)).toEqual([0, 0, 3, 0, 6, 0, 8, 0]);
            expect(solver.toData().entities).toHaveLength(2);
            expect(solver.toData().constraints).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    // the same arch as a NURBS: x = 6 crosses it at (6, 4.8), its t = 0.6 point — inside the
    // domain [0, 1] the clamped knots give it
    test("moves a nurbs' end onto a boundary crossing inside its domain, pinned there", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const nurbs = solver.addNurbs([0, 0, 10 / 3, 20 / 3, 20 / 3, 20 / 3, 10, 0], defaultNurbsSpec(4));
            const boundary = solver.addLine(6, -5, 6, 15);
            const options: ExtendOptions = {
                targetId: nurbs,
                targetUv: [10, 0],
                boundaryId: boundary,
                boundaryUv: [6, 4.8],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            // a NURBS has no support past its domain, so a corner inside it is the only one it
            // can reach: the far end gives ground to the crossing rather than growing past it
            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            expect(preview!).toHaveLength(1);
            expect(preview![0].role).toBe("remove");
            const given = polylinePointsOf(preview![0].piece);
            nearPoint(given[0], [6, 4.8], 1e-2);
            nearPoint(given[given.length - 1], [10, 0], 1e-2);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([nurbs]);
            expect(outcome.removedConstraints).toEqual([]);
            // the far end sits on the crossing, and the clamped domain is now [0, 0.6]
            expect(paramsOf(solver, nurbs)).toEqual([0, 0, 2, 4, 4, 5.6, 6, 4.8, 1, 1, 1, 1]);
            near(entityDomain(entityOf(solver, nurbs))[1], 0.6, 1e-6);
            expect(paramsOf(solver, boundary)).toEqual([6, -5, 6, 15]);

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(1);
            expect(refPairs(pins[0])).toEqual([
                [nurbs, 3],
                [boundary, 0],
                [boundary, 1],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // The boundary x = 0 meets this nurbs past its clamped end (8, 8), where its own span's
    // polynomial carries on to (0, 18) — a corner a bezier reaches the same way, the NURBS
    // reading it one span at a time rather than over a unit domain.
    test("extends a nurbs past its clamped end along its own span's polynomial", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const nurbs = solver.addNurbs([0, 0, 0, 4, 8, 4, 8, 8], defaultNurbsSpec(4));
            const boundary = solver.addLine(0, 10, 0, 20);
            const options: ExtendOptions = {
                targetId: nurbs,
                targetUv: [8, 8],
                boundaryId: boundary,
                boundaryUv: [0, 17],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            expect(extendPreview(solver, options)).toHaveLength(1);
            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([nurbs]);
            expect(outcome.removedConstraints).toEqual([]);
            // the original span is untouched and the continuation is one span's poles more:
            // the corner itself is the last pole, and the knot 1 has moved into the interior
            const params = paramsOf(solver, nurbs);
            expect(params.slice(0, 8)).toEqual([0, 0, 0, 4, 8, 4, 8, 8]);
            expect(params.slice(14)).toEqual([1, 1, 1, 1, 1, 1, 1]);
            nearPoint([params[8], params[9]], [8, 10], 1e-6);
            nearPoint([params[10], params[11]], [6, 13], 1e-6);
            nearPoint([params[12], params[13]], [0, 18], 1e-6);

            const entity = entityOf(solver, nurbs);
            expect(entity.type).toBe("nurbs");
            const knots = entity.nurbs?.knots ?? [];
            expect(knots).toHaveLength(11);
            expect(knots.slice(0, 7)).toEqual([0, 0, 0, 0, 1, 1, 1]);
            for (const knot of knots.slice(7)) near(knot, 1.5, 1e-6);
            // the curve it had is the curve it still has: same points at the same parameters
            nearPoint(evaluateEntity(entity, 0.5), [4, 4], 1e-6);
            nearPoint(evaluateEntity(entity, 1.5), [0, 18], 1e-6);

            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins).toHaveLength(1);
            expect(refPairs(pins[0])).toEqual([
                [nurbs, 6],
                [boundary, 0],
                [boundary, 1],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // the arc is the second quadrant of the (10, 0)/8×6 ellipse (sweep [π/2, π]); the
    // boundary x = 6 crosses its support again at (6, −3√3), at t = 4π/3 past the end
    test("extends an ellipseArc's end along its support out to a line boundary", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const arc = solver.addEllipseArc(10, 0, 18, 0, 10, 6, 10, 6, 2, 0);
            const boundary = solver.addLine(6, -10, 6, 10);
            const corner: [number, number] = [6, -3 * Math.sqrt(3)];
            const options: ExtendOptions = {
                targetId: arc,
                targetUv: [2, 0],
                boundaryId: boundary,
                boundaryUv: [6, -2.9],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };

            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            expect(preview!).toHaveLength(1);
            expect(preview![0].role).toBe("add");
            const gained = polylinePointsOf(preview![0].piece);
            expect(gained.length).toBeGreaterThan(2);
            nearPoint(gained[0], [2, 0], 1e-2);
            nearPoint(gained[gained.length - 1], corner, 1e-2);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([arc]);
            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);

            // the frame and the start rim are untouched; the end rim rides out to the corner
            const params = entityOf(solver, arc).params;
            expect(roundParams(params.slice(0, 8))).toEqual([10, 0, 18, 0, 10, 6, 10, 6]);
            nearPoint(params.slice(8, 10), corner, 1e-6);
            // the sweep grew from [π/2, π] to [π/2, 4π/3]
            const [start, end] = ellipseSweep(params);
            near(start, Math.PI / 2, 1e-6);
            near(end, (4 * Math.PI) / 3, 1e-6);
            expect(paramsOf(solver, boundary)).toEqual([6, -10, 6, 10]);

            // the moved rim is pinned onto the boundary
            const pins = constraintsOf(solver, ConstraintKind.PointOnLine);
            expect(pins.map((pin) => refPairs(pin))).toEqual([
                [
                    [arc, 4],
                    [boundary, 0],
                    [boundary, 1],
                ],
            ]);

            expect(solver.solve(true).result).toBe("OkUnderconstrained");
            const settled = entityOf(solver, arc).params;
            expect(roundParams(settled.slice(0, 8))).toEqual([10, 0, 18, 0, 10, 6, 10, 6]);
            nearPoint(settled.slice(8, 10), corner, 1e-6);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });
});

describe("breakEntity on the curve families", () => {
    // the cubic with these poles is x = 10t, y = 20t(1 − t): (5, 5) sits at t = 1/2 exactly
    test("breaks a bezier at an interior point into two coincident halves re-tracing it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 10 / 3, 20 / 3, 20 / 3, 20 / 3, 10, 0]);

            const outcome = brokenAt(solver, bezier, [[5, 5]]);

            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(bezier);
            expect(entityOf(solver, added).type).toBe("bezier");
            // the click reaches the cut through the sampled arclength reading (parameterAt
            // → pointAt → projectPoint), landing it within ~1e-3 of the exact apex: the
            // halves' shared pole is the curve point at the split, not the click itself
            const keptParams = entityOf(solver, kept).params;
            const addedParams = entityOf(solver, added).params;
            nearPoint(keptParams.slice(6, 8), [5, 5], 1e-3);
            nearPoint(addedParams.slice(0, 2), [5, 5], 1e-3);
            // the original's own ends survive the reparametrization untouched
            expect(keptParams.slice(0, 2)).toEqual([0, 0]);
            expect(addedParams.slice(6, 8)).toEqual([10, 0]);

            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints).toHaveLength(1);
            expect(refPairs(joints[0])).toEqual([
                [kept, 3],
                [added, 0],
            ]);

            // the split is exact de Casteljau at the recovered parameter (on this arch the
            // apex reads x = 10t), so each half re-traces its own span of the original
            const tSplit = keptParams[6] / 10;
            near(tSplit, 0.5, 1e-3);
            const originalPoles: [number, number][] = [
                [0, 0],
                [10 / 3, 20 / 3],
                [20 / 3, 20 / 3],
                [10, 0],
            ];
            const keptPoles = polesOf(keptParams, 4);
            const addedPoles = polesOf(addedParams, 4);
            for (const u of [0.25, 0.5, 0.75]) {
                nearPoint(evaluateBezier(keptPoles, u), evaluateBezier(originalPoles, tSplit * u), 1e-9);
                nearPoint(
                    evaluateBezier(addedPoles, u),
                    evaluateBezier(originalPoles, tSplit + (1 - tSplit) * u),
                    1e-9,
                );
            }
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    // the same arch as a NURBS: the click lands the cut on t = 0.5, the apex, one knot raised
    // to full multiplicity there
    test("breaks a nurbs at an interior point into two coincident halves re-tracing it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const nurbs = solver.addNurbs([0, 0, 10 / 3, 20 / 3, 20 / 3, 20 / 3, 10, 0], defaultNurbsSpec(4));

            const outcome = brokenAt(solver, nurbs, [[5, 5]]);

            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(nurbs);
            expect(entityOf(solver, kept).type).toBe("nurbs");
            expect(entityOf(solver, added).type).toBe("nurbs");
            // the cut reaches through the sampled arclength reading (parameterAt → pointAt →
            // projectPoint), landing within ~1e-3 of the exact apex: the halves' shared pole is
            // the curve point at the split, not the click itself, and each half keeps four poles
            const keptParams = entityOf(solver, kept).params;
            const addedParams = entityOf(solver, added).params;
            nearPoint(keptParams.slice(6, 8), [5, 5], 1e-3);
            nearPoint(addedParams.slice(0, 2), [5, 5], 1e-3);
            // the original's own ends survive, and a nurbs keeps its unit weights
            expect(keptParams.slice(0, 2)).toEqual([0, 0]);
            expect(addedParams.slice(6, 8)).toEqual([10, 0]);
            expect(keptParams.slice(8)).toEqual([1, 1, 1, 1]);
            expect(addedParams.slice(8)).toEqual([1, 1, 1, 1]);

            // the cut is a knot at the recovered parameter, and it survives as each half's
            // clamped end — the kept half on [0, t], the added half on [t, 1]
            const tSplit = keptParams[6] / 10;
            near(tSplit, 0.5, 1e-3);
            const keptKnots = nurbsSpec(entityOf(solver, kept)).knots;
            const addedKnots = nurbsSpec(entityOf(solver, added)).knots;
            expect(keptKnots.slice(0, 4)).toEqual([0, 0, 0, 0]);
            for (const knot of keptKnots.slice(4)) near(knot, tSplit, 1e-3);
            for (const knot of addedKnots.slice(0, 4)) near(knot, tSplit, 1e-3);
            expect(addedKnots.slice(4)).toEqual([1, 1, 1, 1]);
            near(entityDomain(entityOf(solver, kept))[1], tSplit, 1e-3);
            near(entityDomain(entityOf(solver, added))[0], tSplit, 1e-3);

            // each half re-traces its own span of the original, at the original's own parameter
            // (de Casteljau at the recovered parameter, which is the apex on this arch)
            const originalPoles: [number, number][] = [
                [0, 0],
                [10 / 3, 20 / 3],
                [20 / 3, 20 / 3],
                [10, 0],
            ];
            for (const frac of [0.25, 0.5, 0.75]) {
                nearPoint(
                    evaluateEntity(entityOf(solver, kept), tSplit * frac),
                    evaluateBezier(originalPoles, tSplit * frac),
                    1e-6,
                );
                const far = tSplit + (1 - tSplit) * frac;
                nearPoint(
                    evaluateEntity(entityOf(solver, added), far),
                    evaluateBezier(originalPoles, far),
                    1e-6,
                );
            }

            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints).toHaveLength(1);
            expect(refPairs(joints[0])).toEqual([
                [kept, 3],
                [added, 0],
            ]);
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("breakPreview marks the cut projected on the curve, and nothing at an end", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const bezier = solver.addBezier([0, 0, 10 / 3, 20 / 3, 20 / 3, 20 / 3, 10, 0]);

            const markers = breakPreview(solver, bezier, [[5, 4]], TOLERANCE);
            expect(markers).toHaveLength(1);
            nearPoint(markers[0], [5, 5], 1e-3);
            // the end zone reads the sampled arclength, whose 64-vs-128-step slack (~5e-4
            // on this curve) only a screen-scale pick tolerance covers — the editor passes
            // 8 px in sketch units (SketchEditor.screenTolerance)
            expect(breakPreview(solver, bezier, [[10, 0]], 1e-2)).toEqual([]);
            expect(breakPreview(solver, bezier, [], TOLERANCE)).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("breaks an ellipse at two points into two ellipseArcs held rim to rim", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const ellipse = solver.addEllipse(0, 0, 4, 0, 0, 2);

            const outcome = brokenAt(solver, ellipse, [
                [4, 0],
                [-4, 0],
            ]);

            expect(outcome.removedConstraints).toEqual([]);
            expect(outcome.deletedEntities).toEqual([]);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(ellipse);
            // the ellipse keeps its id and its frame, retyped; the second half is new,
            // and each half's rim points are the other's cuts
            expect(entityOf(solver, kept).type).toBe("ellipseArc");
            expect(entityOf(solver, added).type).toBe("ellipseArc");
            expect(paramsOf(solver, kept)).toEqual([0, 0, 4, 0, 0, 2, 4, 0, -4, 0]);
            expect(paramsOf(solver, added)).toEqual([0, 0, 4, 0, 0, 2, -4, 0, 4, 0]);

            // two rim joints and one shared frame: five coincidences
            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints.map((joint) => refPairs(joint))).toEqual([
                [
                    [kept, 4],
                    [added, 3],
                ],
                [
                    [kept, 3],
                    [added, 4],
                ],
                [
                    [kept, 0],
                    [added, 0],
                ],
                [
                    [kept, 1],
                    [added, 1],
                ],
                [
                    [kept, 2],
                    [added, 2],
                ],
            ]);

            // the halves split the turn between them
            const keptSweep = ellipseSweep(entityOf(solver, kept).params);
            const addedSweep = ellipseSweep(entityOf(solver, added).params);
            near(keptSweep[1] - keptSweep[0], Math.PI);
            near(addedSweep[1] - addedSweep[0], Math.PI);
            near(keptSweep[1] - keptSweep[0] + (addedSweep[1] - addedSweep[0]), Math.PI * 2);

            expect(solver.solve(true).result).toBe("OkUnderconstrained");
            expect(paramsOf(solver, kept)).toEqual([0, 0, 4, 0, 0, 2, 4, 0, -4, 0]);
            expect(paramsOf(solver, added)).toEqual([0, 0, 4, 0, 0, 2, -4, 0, 4, 0]);
            // the union still traces the original ellipse, sampled across both sweeps
            for (const id of [kept, added]) {
                const params = entityOf(solver, id).params;
                const [start, end] = ellipseSweep(params);
                for (const u of [0.25, 0.5, 0.75]) {
                    const [x, y] = evaluateEllipse(params, start + (end - start) * u);
                    near((x / 4) ** 2 + (y / 2) ** 2, 1);
                }
            }
            expectCleanSolve(solver);
        } finally {
            solver.dispose();
        }
    });

    test("breakPreview projects an ellipse's cuts, one marker per point given", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const ellipse = solver.addEllipse(0, 0, 4, 0, 0, 2);

            // a closed curve's first cut previews on its own — the command is still collecting
            const one = breakPreview(solver, ellipse, [[4, 0]], TOLERANCE);
            expect(one).toHaveLength(1);
            nearPoint(one[0], [4, 0]);

            const two = breakPreview(
                solver,
                ellipse,
                [
                    [4, 0],
                    [-4, 0],
                ],
                TOLERANCE,
            );
            expect(two).toHaveLength(2);
            nearPoint(two[0], [4, 0]);
            nearPoint(two[1], [-4, 0]);
        } finally {
            solver.dispose();
        }
    });
});

/**
 * An offset copy is prolonged like any other curve, and what moves is not a point: a copy has
 * none — its end is a *window* on the source it reads (`OffsetCurveRef.window`).
 */
describe("extendEntity on an offset copy", () => {
    /** A straight cubic from the origin to (12, 0) with its copy one unit above it. */
    function copySolver(): { solver: SketchSolver; source: number; copy: number } {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addBezier([0, 0, 4, 0, 8, 0, 12, 0]);
            solver.solve(true);
            const offset = offsetEntities(solver, [source], 1, TOLERANCE);
            if (!offset.isOk) throw new Error(offset.error);
            return { solver, source, copy: offset.value.createdEntityIds[0] };
        } catch (error) {
            solver.dispose();
            throw error;
        }
    }

    /** The parameter range the copy is drawn over — its window, on the source's own reading. */
    function drawnWindow(solver: SketchSolver, copyId: number): [number, number] {
        return entityDomain(entityOf(solver, copyId));
    }

    test("prolongs a copy to a boundary that lies inside its source", () => {
        const { solver, source, copy } = copySolver();
        try {
            // the copy stops half way along its source, and the line at x = 9 crosses the
            // support it would have had
            solver.setOffsetWindow(copy, [0, 0.5]);
            const boundary = solver.addLine(9, 0, 9, 3);
            solver.solve(true);

            const options: ExtendOptions = {
                targetId: copy,
                targetUv: [5, 1],
                boundaryId: boundary,
                boundaryUv: [9, 2],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };
            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            const gained = polylinePointsOf(preview![0].piece);
            nearPoint(gained[0], [6, 1], 1e-2);
            nearPoint(gained[gained.length - 1], [9, 1], 1e-2);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([copy]);
            near(drawnWindow(solver, copy)[1], 0.75, 1e-6);
            // the source it reads is not touched: the corner was on the source it already had
            expect(paramsOf(solver, source)).toEqual([0, 0, 4, 0, 8, 0, 12, 0]);
            expect(paramsOf(solver, boundary)).toEqual([9, 0, 9, 3]);
        } finally {
            solver.dispose();
        }
    });

    test("grows the source when the corner lies past its end", () => {
        const { solver, source, copy } = copySolver();
        try {
            const boundary = solver.addLine(15, 0, 15, 3);
            solver.solve(true);

            const options: ExtendOptions = {
                targetId: copy,
                targetUv: [11, 1],
                boundaryId: boundary,
                boundaryUv: [15, 2],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };
            const preview = extendPreview(solver, options);
            expect(preview).toBeDefined();
            // the plan draws both halves of what it does: the copy's gain, and the source's
            const grown = polylinePointsOf(preview![0].piece);
            nearPoint(grown[grown.length - 1], [15, 1], 1e-2);
            const sourceGain = polylinePointsOf(preview![1].piece);
            nearPoint(sourceGain[sourceGain.length - 1], [15, 0], 1e-2);

            const outcome = extended(solver, options);
            expect(outcome.entityIds).toEqual([copy, source]);
            // the source now reaches the corner's preimage: its own end is on the line y = 0
            // under (15, 1), and the curve it had before is still traced by the new one
            const sourceAfter = entityOf(solver, source);
            nearPoint(evaluateEntity(sourceAfter, entityDomain(sourceAfter)[1]), [15, 0], 1e-6);
            expect(polesOf(paramsOf(solver, source), 4)).toEqual([
                [0, 0],
                [5, 0],
                [10, 0],
                [15, 0],
            ]);
            // the copy runs over the whole of its source again — its window was the whole of
            // the shorter one, and it is the whole of the longer one too
            expect(entityOf(solver, copy).offset?.window).toBeUndefined();
            nearPoint(evaluateEntity(entityOf(solver, copy), 1), [15, 1], 1e-6);
        } finally {
            solver.dispose();
        }
    });

    test("brings the boundary to the corner too, when the option asks", () => {
        const { solver, copy } = copySolver();
        try {
            solver.setOffsetWindow(copy, [0, 0.5]);
            const boundary = solver.addLine(9, 0.5, 9, 5);
            solver.solve(true);

            extended(solver, {
                targetId: copy,
                targetUv: [5, 1],
                boundaryId: boundary,
                boundaryUv: [9, 4],
                modifyBoundary: true,
                tolerance: TOLERANCE,
            });

            near(drawnWindow(solver, copy)[1], 0.75, 1e-6);
            // the boundary's end nearer the click comes back to the corner, exactly as it does
            // when the target is a curve of its own
            expect(paramsOf(solver, boundary)).toEqual([9, 0.5, 9, 1]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a copy that runs over the whole of a closed source", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const ellipse = solver.addEllipse(0, 0, 10, 0, 0, 5);
            solver.solve(true);
            const offset = offsetEntities(solver, [ellipse], 1, TOLERANCE);
            if (!offset.isOk) throw new Error(offset.error);
            const copy = offset.value.createdEntityIds[0];
            const boundary = solver.addLine(20, 0, 20, 10);
            solver.solve(true);

            const options: ExtendOptions = {
                targetId: copy,
                targetUv: [11, 0],
                boundaryId: boundary,
                boundaryUv: [20, 5],
                modifyBoundary: false,
                tolerance: TOLERANCE,
            };
            expect(extendPreview(solver, options)).toBeUndefined();
            const result = extendEntity(solver, options);
            expect(result.isOk).toBe(false);
            if (result.isOk) throw new Error("unreachable");
            expect(result.error).toBe("A closed copy has no end to extend");
        } finally {
            solver.dispose();
        }
    });
});
