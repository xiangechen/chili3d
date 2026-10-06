// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { rs } from "@rstest/core";
import {
    type ExtendOptions,
    type ExtendOutcome,
    extendEntity,
    extendPreview,
} from "../../src/sketch/extendOps";
import {
    ConstraintKind,
    type ExternalRefData,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { centerRef, lineRefs } from "../../src/sketch/solverEntities";
import "./setup";

const TOLERANCE = 1e-6;

function options(overrides: Partial<ExtendOptions> = {}): ExtendOptions {
    return {
        targetId: 1,
        targetUv: [9, 0],
        boundaryId: 2,
        boundaryUv: [12, 0],
        modifyBoundary: false,
        tolerance: TOLERANCE,
        ...overrides,
    };
}

function extend(solver: SketchSolver, overrides: Partial<ExtendOptions> = {}): ExtendOutcome {
    const result = extendEntity(solver, options(overrides));
    if (!result.isOk) throw new Error(`the extend was refused: ${result.error}`);
    return result.value;
}

function refusal(solver: SketchSolver, overrides: Partial<ExtendOptions> = {}): string {
    const result = extendEntity(solver, options(overrides));
    if (result.isOk) throw new Error("the extend was expected to be refused");
    return result.error;
}

function entityOf(solver: SketchSolver, id: number): SketchEntityData {
    const entity = solver.entity(id);
    expect(entity).toBeDefined();
    return entity!;
}

/** An entity's params rounded, for comparing geometry. */
function params(solver: SketchSolver, id: number): number[] {
    return entityOf(solver, id).params.map((value) => Math.round(value * 1e6) / 1e6);
}

function constraintsOf(solver: SketchSolver, kind: ConstraintKind): SketchConstraintData[] {
    return solver.toData().constraints.filter((constraint) => constraint.kind === kind);
}

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

const EXT_LINE: ExternalRefData = {
    entityId: -100,
    nodeId: "src",
    edge: { kind: "line", start: { x: 20, y: -5, z: 0 }, end: { x: 20, y: 5, z: 0 } },
    role: "reference",
    snapshot: [20, -5, 20, 5],
    type: "line",
};

/** A horizontal line to prolong, and a boundary line at x = 20 to run it out to. */
function crossSolver(): { solver: SketchSolver; target: number; boundary: number } {
    const solver = new SketchSolver(Plane.XY);
    const target = solver.addLine(0, 0, 10, 0);
    const boundary = solver.addLine(20, -5, 20, 5);
    return { solver, target, boundary };
}

describe("extendEntity", () => {
    test("runs the end nearest the click out to the corner", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            const outcome = extend(solver, { targetId: target, boundaryId: boundary });

            expect(outcome.entityIds).toEqual([target]);
            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
            expect(params(solver, boundary)).toEqual([20, -5, 20, 5]);
        } finally {
            solver.dispose();
        }
    });

    test("grows the end the corner lies beyond, whichever half was clicked", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            // the click is on the origin half, but the corner at x = 20 lies past the far
            // end: an extension is settled by where it is going, not by which half was hit
            extend(solver, { targetId: target, boundaryId: boundary, targetUv: [2, 0] });

            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("grows the origin end when the click is on that half and the corner is behind it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const behind = solver.addLine(-5, -5, -5, 5);

            extend(solver, {
                targetId: target,
                targetUv: [2, 0],
                boundaryId: behind,
                boundaryUv: [-5, 0],
            });

            expect(params(solver, target)).toEqual([-5, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("pins the new endpoint onto the boundary", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            extend(solver, { targetId: target, boundaryId: boundary });

            expect(constraintsOf(solver, ConstraintKind.PointOnLine)).toEqual([
                expect.objectContaining({ refs: [ref(target, 1), ...lineRefs(boundary)] }),
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("meets a boundary the corner lies beyond the end of", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            // a short segment that does not itself reach y = 0: it is its support line
            // the target runs out to, the same reading a trim gives its cutters
            const boundary = solver.addLine(20, 2, 20, 6);

            extend(solver, { targetId: target, boundaryId: boundary });

            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("takes the crossing on the click's side of a circle", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 4, 0);
            const circle = solver.addCircle(10, 0, 5);

            extend(solver, {
                targetId: target,
                targetUv: [3.5, 0],
                boundaryId: circle,
                boundaryUv: [5, 0],
            });

            expect(params(solver, target)).toEqual([0, 0, 5, 0]);
            expect(constraintsOf(solver, ConstraintKind.PointOnCircle)).toEqual([
                expect.objectContaining({ refs: [ref(target, 1), centerRef(circle)] }),
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("coincides the endpoint when the corner is the boundary's own end", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(20, 0, 20, 10);

            extend(solver, {
                targetId: target,
                boundaryId: boundary,
                boundaryUv: [20, 2],
                modifyBoundary: true,
            });

            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
            expect(constraintsOf(solver, ConstraintKind.P2PCoincident)).toEqual([
                expect.objectContaining({ refs: [ref(target, 1), ref(boundary, 0)] }),
            ]);
            // the boundary's end is already on the corner, so it is left exactly as it was
            expect(params(solver, boundary)).toEqual([20, 0, 20, 10]);
        } finally {
            solver.dispose();
        }
    });

    test("cuts back to a corner that lies inside the target", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(5, -5, 5, 5);

            extend(solver, { targetId: target, boundaryId: boundary });

            expect(params(solver, target)).toEqual([0, 0, 5, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("runs out to a datum axis, read as the infinite line it is drawn as", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the axis is stored as a unit segment; the target meets it nowhere near it
            const target = solver.addLine(20, -5, 20, -1);
            expect(entityOf(solver, -2).params).toEqual([0, 0, 1, 0]);

            extend(solver, {
                targetId: target,
                targetUv: [20, -1.5],
                boundaryId: -2,
                boundaryUv: [20, 0],
            });

            expect(params(solver, target)).toEqual([20, -5, 20, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("runs out to an external reference", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            solver.addExternalEntity({ ...EXT_LINE });

            extend(solver, { targetId: target, boundaryId: EXT_LINE.entityId });

            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
        } finally {
            solver.dispose();
        }
    });
});

describe("extendEntity refusals", () => {
    test("refuses when the supports never meet", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(0, 5, 10, 5);

            expect(refusal(solver, { targetId: target, boundaryId: boundary })).toBe(
                "The two entities do not meet when extended",
            );
            expect(params(solver, target)).toEqual([0, 0, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses two collinear entities, which share no single corner", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(20, 0, 30, 0);

            expect(refusal(solver, { targetId: target, boundaryId: boundary })).toBe(
                "The two entities do not meet when extended",
            );
        } finally {
            solver.dispose();
        }
    });

    test("refuses a circle as the target", () => {
        const { solver, boundary } = crossSolver();
        try {
            const circle = solver.addCircle(0, 0, 3);
            expect(refusal(solver, { targetId: circle, boundaryId: boundary })).toBe(
                "A circle has no end to extend",
            );
        } finally {
            solver.dispose();
        }
    });

    test("refuses the datum and the external references as the target", () => {
        const { solver, boundary } = crossSolver();
        try {
            expect(refusal(solver, { targetId: -2, boundaryId: boundary })).toBe(
                "The datum and external references cannot be extended",
            );
        } finally {
            solver.dispose();
        }
    });

    test("refuses an entity as its own boundary", () => {
        const { solver, target } = crossSolver();
        try {
            expect(refusal(solver, { targetId: target, boundaryId: target })).toBe(
                "Pick a different entity for the boundary",
            );
        } finally {
            solver.dispose();
        }
    });

    test("refuses when the end already sits on the corner", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // the target's far end is already on the boundary's support line
            const target = solver.addLine(0, 0, 20, 0);
            const boundary = solver.addLine(20, -5, 20, 5);

            expect(
                refusal(solver, {
                    targetId: target,
                    targetUv: [19, 0],
                    boundaryId: boundary,
                }),
            ).toBe("The entity already reaches the corner");
        } finally {
            solver.dispose();
        }
    });

    test("refuses a corner the target already reaches from its other end", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addArc(0, 0, 10, 0, 0, 10);
            // x = 10 touches the arc's own circle exactly at the arc's start, and the click
            // is near the far end — the one an arc never re-decides (see `endToMove`), so
            // the picked end is the collapse and not the corner. The arc does reach the
            // corner, from its other end, which is the refusal the user is owed
            const boundary = solver.addLine(10, -5, 10, 5);

            expect(
                refusal(solver, {
                    targetId: target,
                    targetUv: [0.5, 9.9],
                    boundaryId: boundary,
                    boundaryUv: [10, 2],
                }),
            ).toBe("The entity already reaches the corner");
        } finally {
            solver.dispose();
        }
    });

    test("rolls the sketch back when the solve comes back broken", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            // a prolongation is a slide along the entity's own curve, so no constraint
            // set can make the solve break on its own: the guard is driven directly
            const real = solver.solve.bind(solver);
            let calls = 0;
            const spy = rs.spyOn(solver, "solve").mockImplementation((fine: boolean) => {
                const outcome = real(fine);
                return ++calls === 1 ? outcome : { ...outcome, result: "Conflicting" };
            });
            try {
                expect(refusal(solver, { targetId: target, boundaryId: boundary })).toMatch(
                    /could not solve after the extend/,
                );
            } finally {
                spy.mockRestore();
            }

            expect(params(solver, target)).toEqual([0, 0, 10, 0]);
            expect(solver.toData().constraints).toEqual([]);
        } finally {
            solver.dispose();
        }
    });
});

describe("extendEntity constraints", () => {
    test("reads a tolerance of zero as the least confirmable distance the plan uses", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            // the corner (20, 0) lands a hair off the boundary's own end (20, 1e-7)
            const boundary = solver.addLine(20, 1e-7, 20, 10);

            extend(solver, {
                targetId: target,
                targetUv: [9, 0],
                boundaryId: boundary,
                boundaryUv: [20, 8],
                tolerance: 0,
            });

            // the floor is the plan's, not the caller's, so the pin has to read the cut on
            // the boundary's end the same way the plan that chose the corner did
            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints).toHaveLength(1);
            expect(joints[0].refs).toEqual([ref(target, 1), ref(boundary, 0)]);
        } finally {
            solver.dispose();
        }
    });

    test("drops the coincidence the moved end was held by", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            const neighbour = solver.addLine(10, 0, 10, -5);
            const joint = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(target, 1), ref(neighbour, 0)],
            });

            const outcome = extend(solver, { targetId: target, boundaryId: boundary });

            expect(outcome.removedConstraints).toEqual([joint]);
            // the neighbour stays where it was: only the picked entity moves
            expect(params(solver, neighbour)).toEqual([10, 0, 10, -5]);
        } finally {
            solver.dispose();
        }
    });

    test("keeps the direction constraint a line keeps through the move", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: lineRefs(target),
            });

            const outcome = extend(solver, { targetId: target, boundaryId: boundary });

            expect(outcome.removedConstraints).toEqual([]);
            expect(constraintsOf(solver, ConstraintKind.Horizontal)).toHaveLength(1);
            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("drops a length dimension the prolongation would otherwise fight", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            const length = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: lineRefs(target),
                datum: 10,
            });

            const outcome = extend(solver, { targetId: target, boundaryId: boundary });

            expect(outcome.removedConstraints).toEqual([length]);
            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
        } finally {
            solver.dispose();
        }
    });
});

describe("extendEntity modifyBoundary", () => {
    test("brings the boundary's own end to the corner too", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(20, -10, 20, 10);

            const outcome = extend(solver, {
                targetId: target,
                boundaryId: boundary,
                boundaryUv: [20, -8],
                modifyBoundary: true,
            });

            expect(outcome.entityIds).toEqual([target, boundary]);
            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
            expect(params(solver, boundary)).toEqual([20, 0, 20, 10]);
            expect(constraintsOf(solver, ConstraintKind.PointOnLine)).toHaveLength(1);
        } finally {
            solver.dispose();
        }
    });

    test("brings the boundary's other end when the corner lies past the picked one", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            // the corner (20, 0) lies below the boundary's own origin end, so the far end
            // — the one the click is near — is not the one that can reach it
            const boundary = solver.addLine(20, 5, 20, 25);

            const outcome = extend(solver, {
                targetId: target,
                boundaryId: boundary,
                boundaryUv: [20, 24],
                modifyBoundary: true,
            });

            expect(outcome.entityIds).toEqual([target, boundary]);
            expect(params(solver, target)).toEqual([0, 0, 20, 0]);
            expect(params(solver, boundary)).toEqual([20, 0, 20, 25]);
        } finally {
            solver.dispose();
        }
    });

    test("leaves a boundary that already reaches the corner where it is", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            // the corner (15, 0) is the arc's own origin end, and the click is near the far
            // end — an arc is never re-decided from the click, so aiming at the picked end
            // would read as a move that swallows the whole arc
            const arc = solver.addArc(20, 0, 15, 0, 20, 5);

            const outcome = extend(solver, {
                targetId: target,
                targetUv: [9, 0],
                boundaryId: arc,
                boundaryUv: [16, 1],
                modifyBoundary: true,
            });

            expect(outcome.entityIds).toEqual([target]);
            expect(params(solver, target)).toEqual([0, 0, 15, 0]);
            expect(params(solver, arc)).toEqual([20, 0, 15, 0, 20, 5]);
            // and the two are still joined: the target's new end is the arc's origin end
            const joints = constraintsOf(solver, ConstraintKind.P2PCoincident);
            expect(joints).toHaveLength(1);
            expect(joints[0].refs).toEqual([ref(target, 1), ref(arc, 1)]);
        } finally {
            solver.dispose();
        }
    });

    test("extends the target even when the boundary's own move would close it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a 350-degree arc: its far end sits a hair short of a full turn from the origin
            // end, so moving it to a corner just below (10, 0) would close the arc
            const sweep = (Math.PI * 2 * 350) / 360;
            const far: [number, number] = [10 * Math.cos(sweep), 10 * Math.sin(sweep)];
            const arc = solver.addArc(0, 0, 10, 0, far[0], far[1]);
            const before = params(solver, arc);
            const target = solver.addLine(0, -0.005, 8, -0.005);

            const outcome = extend(solver, {
                targetId: target,
                targetUv: [7, -0.005],
                boundaryId: arc,
                boundaryUv: far,
                modifyBoundary: true,
            });

            // the boundary's move is the gesture's second half, never its point: refused, it
            // falls away as a boundary with no end to move does, and the target stands
            expect(outcome.entityIds).toEqual([target]);
            expect(params(solver, target)).toEqual([0, -0.005, 9.999999, -0.005]);
            expect(params(solver, arc)).toEqual(before);
        } finally {
            solver.dispose();
        }
    });

    test("never moves a boundary the sketch may not move: a datum axis", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(20, -5, 20, -1);

            // the solver throws rather than refusing when a datum point is moved, so this
            // has to fall away at the planning stage, not on the way to the solver
            const outcome = extend(solver, {
                targetId: target,
                targetUv: [20, -1.5],
                boundaryId: -2,
                boundaryUv: [20, 0],
                modifyBoundary: true,
            });

            expect(outcome.entityIds).toEqual([target]);
            expect(params(solver, target)).toEqual([20, -5, 20, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("leaves the boundary alone when the option is off", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(20, -10, 20, 10);

            const outcome = extend(solver, {
                targetId: target,
                boundaryId: boundary,
                boundaryUv: [20, -8],
            });

            expect(outcome.entityIds).toEqual([target]);
            expect(params(solver, boundary)).toEqual([20, -10, 20, 10]);
        } finally {
            solver.dispose();
        }
    });

    test("never moves a boundary with no ends of its own", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 4, 0);
            const circle = solver.addCircle(10, 0, 5);

            const outcome = extend(solver, {
                targetId: target,
                targetUv: [3.5, 0],
                boundaryId: circle,
                boundaryUv: [5, 0],
                modifyBoundary: true,
            });

            expect(outcome.entityIds).toEqual([target]);
            expect(entityOf(solver, circle).type).toBe("circle");
            expect(params(solver, circle)).toEqual([10, 0, 5]);
        } finally {
            solver.dispose();
        }
    });
});

describe("extendEntity an arc", () => {
    test("grows the arc along its own circle without closing it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const arc = solver.addArc(0, 0, 10, 0, 0, 10);
            const boundary = solver.addLine(-10, -20, -10, 20);

            extend(solver, {
                targetId: arc,
                targetUv: [0.5, 9.9],
                boundaryId: boundary,
                boundaryUv: [-10, 0],
            });

            expect(params(solver, arc)).toEqual([0, 0, 10, 0, -10, 0]);
        } finally {
            solver.dispose();
        }
    });
});

describe("extendPreview", () => {
    test("hands back the span the target would gain", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            const pieces = extendPreview(solver, options({ targetId: target, boundaryId: boundary }));

            expect(pieces).toEqual([
                { role: "add", piece: { kind: "line", point1: [10, 0], point2: [20, 0] } },
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("previews the span at the end that will move, not the one that was clicked", () => {
        const { solver, target, boundary } = crossSolver();
        try {
            const pieces = extendPreview(
                solver,
                options({ targetId: target, boundaryId: boundary, targetUv: [2, 0] }),
            );

            expect(pieces).toEqual([
                { role: "add", piece: { kind: "line", point1: [10, 0], point2: [20, 0] } },
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("hands back the span a cut back would give up", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(5, -5, 5, 5);

            const pieces = extendPreview(solver, options({ targetId: target, boundaryId: boundary }));

            expect(pieces).toEqual([
                { role: "remove", piece: { kind: "line", point1: [5, 0], point2: [10, 0] } },
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("hands back nothing where the extend would refuse", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const target = solver.addLine(0, 0, 10, 0);
            const boundary = solver.addLine(0, 5, 10, 5);

            expect(
                extendPreview(solver, options({ targetId: target, boundaryId: boundary })),
            ).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });
});
