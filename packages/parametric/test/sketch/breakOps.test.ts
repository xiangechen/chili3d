// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { rs } from "@rstest/core";
import { type BreakOutcome, breakEntity, breakPreview } from "../../src/sketch/breakOps";
import {
    arcAngles,
    ConstraintKind,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { centerRef } from "../../src/sketch/solverEntities";
import "./setup";

const TOLERANCE = 1e-6;

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

function breakAt(solver: SketchSolver, entityId: number, uvs: [number, number][]): BreakOutcome {
    const result = breakEntity(solver, entityId, uvs, TOLERANCE);
    if (!result.isOk) throw new Error(`the break was refused: ${result.error}`);
    return result.value;
}

function refusal(solver: SketchSolver, entityId: number, uvs: [number, number][]): string {
    const result = breakEntity(solver, entityId, uvs, TOLERANCE);
    if (result.isOk) throw new Error("the break was expected to be refused");
    return result.error;
}

function entityOf(solver: SketchSolver, id: number): SketchEntityData {
    const entity = solver.entity(id);
    expect(entity).toBeDefined();
    return entity!;
}

/** A line's four params, rounded, as a plain array. */
function lineParams(solver: SketchSolver, id: number): number[] {
    const entity = entityOf(solver, id);
    expect(entity.type).toBe("line");
    return entity.params.map((value) => Math.round(value * 1e6) / 1e6);
}

function constraintsOf(solver: SketchSolver, kind: ConstraintKind): SketchConstraintData[] {
    return solver.toData().constraints.filter((constraint) => constraint.kind === kind);
}

/** Points rounded to the sketch's own working precision, for comparing projected geometry. */
function rounded(points: readonly [number, number][]): number[][] {
    return points.map(([u, v]) => [Math.round(u * 1e6) / 1e6, Math.round(v * 1e6) / 1e6]);
}

describe("breakEntity a line", () => {
    test("cuts it in two at the click, keeping the origin half's id", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);

            const outcome = breakAt(solver, line, [[4, 0]]);

            expect(outcome.entityIds).toHaveLength(2);
            const [kept, added] = outcome.entityIds;
            expect(kept).toBe(line);
            expect(lineParams(solver, kept)).toEqual([0, 0, 4, 0]);
            expect(lineParams(solver, added)).toEqual([4, 0, 10, 0]);
            expect(outcome.deletedEntities).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("holds the two halves together with a coincidence at the cut", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);

            const outcome = breakAt(solver, line, [[4, 0]]);

            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints).toHaveLength(1);
            expect(joints[0].refs.map((r) => [r.entityId, r.pointIndex])).toEqual([
                [line, 1],
                [outcome.entityIds[1], 0],
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("projects a click that misses the curve onto it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);

            breakAt(solver, line, [[3, 1.5]]);

            expect(lineParams(solver, line)).toEqual([0, 0, 3, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a cut at either end", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            expect(refusal(solver, line, [[0, 0]])).toBe(
                "Pick a point along the entity, not one of its ends",
            );
            expect(refusal(solver, line, [[10, 0]])).toBe(
                "Pick a point along the entity, not one of its ends",
            );
            expect(entityOf(solver, line).params).toEqual([0, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses the datum and the external references", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            expect(refusal(solver, -2, [[5, 0]])).toBe("The datum and external references cannot be broken");
            expect(entityOf(solver, line).params).toEqual([0, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });
});

describe("breakEntity constraints", () => {
    test("moves the far end's constraints onto the new half", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            const other = solver.addLine(10, 0, 10, 5);
            const joint = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(line, 1), ref(other, 0)],
            });

            const outcome = breakAt(solver, line, [[4, 0]]);

            const added = outcome.entityIds[1];
            const moved = constraintsOf(solver, ConstraintKind.P2PCoincident).find((c) => c.id === joint);
            expect(moved?.refs).toEqual([ref(added, 1), ref(other, 0)]);
            expect(outcome.removedConstraints).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("states a horizontal constraint once per half", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [ref(line, 0), ref(line, 1)],
            });

            const outcome = breakAt(solver, line, [[4, 0]]);

            const [kept, added] = outcome.entityIds;
            expect(constraintsOf(solver, ConstraintKind.Horizontal)).toEqual([
                expect.objectContaining({ refs: [ref(kept, 0), ref(kept, 1)] }),
                expect.objectContaining({ refs: [ref(added, 0), ref(added, 1)] }),
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps a length dimension the break leaves satisfied", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(line, 0), ref(line, 1)],
                datum: 10,
            });

            const outcome = breakAt(solver, line, [[4, 0]]);

            // the dimension reads both ends of the original line, which now live on
            // separate halves — it still measures them, and the sketch still solves
            const dimension = constraintsOf(solver, ConstraintKind.P2PDistance)[0];
            expect(dimension.refs).toEqual([ref(outcome.entityIds[0], 0), ref(outcome.entityIds[1], 1)]);
            expect(solver.solve(true).result).not.toBe("Conflicting");
        } finally {
            solver.dispose();
        }
    });

    test("rolls the sketch back when the solve comes back broken", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            // a carve moves nothing, so no constraint set can make the solve break on its
            // own: the guard is driven directly, one real solve then one broken one
            const real = solver.solve.bind(solver);
            let calls = 0;
            const spy = rs.spyOn(solver, "solve").mockImplementation((fine: boolean) => {
                const outcome = real(fine);
                return ++calls === 1 ? outcome : { ...outcome, result: "Conflicting" };
            });
            try {
                expect(refusal(solver, line, [[4, 0]])).toMatch(/could not solve after the break/);
            } finally {
                spy.mockRestore();
            }

            expect(lineParams(solver, line)).toEqual([0, 0, 10, 0]);
            expect(solver.entities()).toHaveLength(1);
        } finally {
            solver.dispose();
        }
    });
});

describe("breakEntity an arc", () => {
    test("splits the sweep between the halves and shares the centre", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const arc = solver.addArc(0, 0, 10, 0, 0, 10);
            const before = arcAngles(entityOf(solver, arc).params)[1];

            const outcome = breakAt(solver, arc, [[Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]]);

            const [kept, added] = outcome.entityIds;
            const keptSweep = arcAngles(entityOf(solver, kept).params)[1];
            const addedSweep = arcAngles(entityOf(solver, added).params)[1];
            expect(keptSweep + addedSweep).toBeCloseTo(before, 6);
            expect(keptSweep).toBeCloseTo(Math.PI / 4, 6);

            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints.map((joint) => joint.refs)).toEqual([
                [centerRef(kept), centerRef(added)],
                [ref(kept, 2), ref(added, 1)],
            ]);
        } finally {
            solver.dispose();
        }
    });
});

describe("breakEntity a circle", () => {
    test("cuts it into two arcs that still add up to the whole", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);

            const outcome = breakAt(solver, circle, [
                [5, 0],
                [-5, 0],
            ]);

            const [first, second] = outcome.entityIds;
            expect(entityOf(solver, first).type).toBe("arc");
            expect(entityOf(solver, second).type).toBe("arc");
            const sweepOf = (id: number) => arcAngles(entityOf(solver, id).params)[1];
            expect(sweepOf(first) + sweepOf(second)).toBeCloseTo(Math.PI * 2, 6);
            expect(sweepOf(first)).toBeCloseTo(Math.PI, 6);
        } finally {
            solver.dispose();
        }
    });

    test("holds the two arcs into one circle: joints, a shared centre and equal radii", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);

            const outcome = breakAt(solver, circle, [
                [5, 0],
                [-5, 0],
            ]);

            const [first, second] = outcome.entityIds;
            expect(constraintsOf(solver, ConstraintKind.P2PCoincident)).toEqual([
                expect.objectContaining({ refs: [ref(first, 2), ref(second, 1)] }),
                expect.objectContaining({ refs: [ref(first, 1), ref(second, 2)] }),
                expect.objectContaining({ refs: [centerRef(first), centerRef(second)] }),
            ]);
            expect(constraintsOf(solver, ConstraintKind.EqualArcRadius)).toHaveLength(1);
        } finally {
            solver.dispose();
        }
    });

    test("leaves the sketch as free as the circle was", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);
            solver.solve(true);
            const before = solver.diagnose().dofs;

            breakAt(solver, circle, [
                [5, 0],
                [-5, 0],
            ]);
            solver.solve(true);

            expect(before).toBe(3);
            expect(solver.diagnose().dofs).toBe(before);
        } finally {
            solver.dispose();
        }
    });

    test("carries a radius dimension over and keeps its reading", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);
            solver.addConstraint({ kind: ConstraintKind.Radius, refs: [centerRef(circle)], datum: 5 });

            breakAt(solver, circle, [
                [5, 0],
                [-5, 0],
            ]);

            const radii = constraintsOf(solver, ConstraintKind.Radius);
            expect(radii).toHaveLength(1);
            expect(radii[0].refs).toEqual([centerRef(circle)]);
            expect(radii[0].datum).toBe(5);
        } finally {
            solver.dispose();
        }
    });

    test("reports the constraints an arc cannot carry", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);
            const other = solver.addCircle(20, 0, 5);
            const equal = solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [centerRef(circle), centerRef(other)],
            });

            const outcome = breakAt(solver, circle, [
                [5, 0],
                [-5, 0],
            ]);

            expect(outcome.removedConstraints).toEqual([equal]);
            expect(constraintsOf(solver, ConstraintKind.EqualRadius)).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a single point on a closed curve", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);
            expect(refusal(solver, circle, [[5, 0]])).toBe("A circle needs a second point to break at");
        } finally {
            solver.dispose();
        }
    });

    test("refuses two points that leave a degenerate arc", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);
            expect(
                refusal(solver, circle, [
                    [5, 0],
                    [5, 1e-9],
                ]),
            ).toBe("Pick two points further apart along the circle");
            expect(entityOf(solver, circle).type).toBe("circle");
        } finally {
            solver.dispose();
        }
    });
});

describe("breakPreview", () => {
    test("marks where a line would be cut", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            expect(breakPreview(solver, line, [[4, 2]], TOLERANCE)).toEqual([[4, 0]]);
        } finally {
            solver.dispose();
        }
    });

    test("marks nothing where the line's own end was clicked", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 10, 0);
            expect(breakPreview(solver, line, [[0, 0]], TOLERANCE)).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("marks both of a circle's cut points", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const circle = solver.addCircle(0, 0, 5);
            const marks = breakPreview(
                solver,
                circle,
                [
                    [5, 0],
                    [0, 6],
                ],
                TOLERANCE,
            );
            expect(rounded(marks)).toEqual([
                [5, 0],
                [0, 5],
            ]);
        } finally {
            solver.dispose();
        }
    });
});
