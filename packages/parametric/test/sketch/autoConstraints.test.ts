// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, Precision } from "@chili3d/core";
import { applyAutoConstraints } from "../../src/sketch/autoConstraints";
import { ConstraintKind, originRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

describe("applyAutoConstraints", () => {
    test("snaps a line endpoint onto a nearby existing point and adds coincident", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(10.2, 0.1, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual(
            solver.pointOf({ entityId: 1, pointIndex: 1 }),
        );
        solver.dispose();
    });

    test("ignores points beyond the tolerance", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(12, 0, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("adds Horizontal to a near-horizontal line", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 10, 0.5); // ~2.9°

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });
        solver.solve(true);

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.Horizontal]);
        const [x1, y1] = solver.pointOf({ entityId: id, pointIndex: 0 });
        const [, y2] = solver.pointOf({ entityId: id, pointIndex: 1 });
        expect(Math.abs(y2 - y1)).toBeLessThan(Precision.Distance);
        solver.dispose();
    });

    test("adds Vertical to a near-vertical line", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 0.4, 10);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.Vertical]);
        solver.dispose();
    });

    test("adds nothing to a steep diagonal line", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 10, 1.5); // ~8.5°

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("does not duplicate an existing Horizontal constraint", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0, 0, 10, 0.2);
        solver.addConstraint({
            kind: ConstraintKind.Horizontal,
            refs: [
                { entityId: id, pointIndex: 0 },
                { entityId: id, pointIndex: 1 },
            ],
        });

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0 });

        expect(added).toEqual([]);
        solver.dispose();
    });

    test("snaps a circle center onto a nearby point", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(5, 5, 15, 5);
        solver.solve(true);
        const id = solver.addCircle(5.1, 5.1, 3);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added.map((x) => x.kind)).toEqual([ConstraintKind.P2PCoincident]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([5, 5]);
        solver.dispose();
    });

    test("never collapses a line onto a single point", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        // both endpoints near the existing start point (0, 0)
        const id = solver.addLine(0.1, 0.1, 0.2, 0.2);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        const coincidents = added.filter((x) => x.kind === ConstraintKind.P2PCoincident);
        expect(coincidents.length).toBeLessThanOrEqual(1);
        const [x1, y1] = solver.pointOf({ entityId: id, pointIndex: 0 });
        const [x2, y2] = solver.pointOf({ entityId: id, pointIndex: 1 });
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(Precision.Distance);
        solver.dispose();
    });

    test("snaps an arc's start and end but never its center", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        // center (0.2, 0.1) sits within tolerance of the line start, start near the line end
        const id = solver.addArc(0.2, 0.1, 10.2, 0.1, 0.2, 8);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 1 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0.2, 0.1]);
        expect(solver.pointOf({ entityId: id, pointIndex: 1 })).toEqual([10, 0]);
        solver.dispose();
    });
});

describe("origin snapping", () => {
    test("snaps an endpoint near the origin onto it and adds coincident", () => {
        const solver = new SketchSolver(Plane.XY);
        const id = solver.addLine(0.2, 0.1, 20, 5);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
        solver.solve(true);

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [{ entityId: id, pointIndex: 0 }, originRef()],
            },
        ]);
        expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([0, 0]);
        solver.dispose();
    });

    test("a real point at the origin wins over the datum on a tie", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);
        solver.solve(true);
        const id = solver.addLine(20, 5, 0.1, 0.1);

        const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });

        expect(added).toEqual([
            {
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                ],
            },
        ]);
        solver.dispose();
    });
});
