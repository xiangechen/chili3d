// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { ConstraintKind, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

describe("SketchSolver.diagnose", () => {
    test("both sides of a datum conflict are reported, uninvolved constraints are not", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 8, 0);
        const refs: SketchPointRef[] = [
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ];
        const horizontal = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        const first = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 10 });
        const second = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 12 });

        expect(solver.solve(true).result).toContain("Conflict");
        const diagnostics = solver.diagnose();
        expect(diagnostics.conflicting).toEqual([first, second]);
        expect(diagnostics.conflicting).not.toContain(horizontal);
        expect(diagnostics.redundant).toEqual([]);
        expect(diagnostics.dofs).toBe(2);
    });

    test("with three contradictory datums, the one garlic treats as established is flagged too", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 8, 0);
        const refs: SketchPointRef[] = [
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ];
        const first = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 10 });
        const second = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 12 });
        const third = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 14 });

        expect(solver.solve(true).result).toContain("Conflict");
        // garlic's flat list names only the later failures — the group counterparts
        // pull in the established constraint they contradict
        expect(solver.diagnose().conflicting).toEqual([first, second, third]);
    });

    test("duplicate geometric constraint is redundant, not conflicting", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        const refs: SketchPointRef[] = [
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ];
        const original = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        const duplicate = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });

        solver.solve(true);
        const diagnostics = solver.diagnose();
        // the whole duplicating pair is flagged — removing either one fixes it
        expect(diagnostics.redundant).toEqual([original, duplicate]);
        expect(diagnostics.conflicting).toEqual([]);
        expect(diagnostics.dofs).toBe(3);
    });

    test("structural datum pins never appear in diagnostics", () => {
        const solver = new SketchSolver(Plane.XY);
        solver.addLine(0, 0, 10, 0);

        solver.solve(true);
        const diagnostics = solver.diagnose();
        expect(diagnostics.conflicting).toEqual([]);
        expect(diagnostics.redundant).toEqual([]);
        expect(diagnostics.dofs).toBe(4);
    });
});

describe("SketchSolver guard conflicts (a size driven to nothing)", () => {
    /**
     * A line held horizontal whose length a datum drives to zero — the segment collapses,
     * so garlic's size guard is violated and the conflict it reports is sourced to the
     * guard rather than to dependent rows. `line` and `refs` come back for a caller that
     * wants to pile a row-sourced conflict on top.
     */
    function collapsedLine() {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        const refs: SketchPointRef[] = [
            { entityId: line, pointIndex: 0 },
            { entityId: line, pointIndex: 1 },
        ];
        const declaring = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        const dimension = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 0 });
        return { solver, refs, declaring, dimension };
    }

    test("the collapsed constraint is reported as a guard conflict, and the flat list still names it", () => {
        const { solver, declaring } = collapsedLine();

        expect(solver.solve(true).result).toContain("Conflict");
        const diagnostics = solver.diagnose();
        // garlic blames the guard's declarer, which is also what the flat conflict list
        // carries — `guardConflicts` is the only place the SOURCE survives.
        expect(diagnostics.guardConflicts).toEqual([declaring]);
        expect(diagnostics.conflicting).toEqual([declaring]);
    });

    test("trial deletion reports nothing for it — and does not call it entangled", () => {
        const { solver } = collapsedLine();
        solver.solve(true);

        const suggestions = solver.recoverySuggestions();
        // Deleting constraints cannot repair a collapsed size, so no culprit is found. That
        // is NOT the entangled case: "remove a combination" would be a wrong answer, and the
        // panel says "change the driving dimension" instead (from `guardConflicts`).
        expect(suggestions.conflicts).toEqual([]);
        expect(suggestions.conflictsEntangled).toBe(false);
        expect(suggestions.truncated).toBe(false);
    });

    test("a row-sourced conflict elsewhere is still answered by deletion", () => {
        const { solver, declaring } = collapsedLine();
        // A second, disconnected line carries a contradictory pair — a row conflict in its
        // own subsystem, beside the collapsed one.
        const other = solver.addLine(20, 0, 28, 0);
        const otherRefs: SketchPointRef[] = [
            { entityId: other, pointIndex: 0 },
            { entityId: other, pointIndex: 1 },
        ];
        const first = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs: otherRefs, datum: 10 });
        const second = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs: otherRefs, datum: 12 });

        solver.solve(true);
        const diagnostics = solver.diagnose();
        // Both kinds coexist, and the guard does not leak into the deletable set: the trial
        // run answers the row conflict with its own pair and says nothing about the guard.
        expect(diagnostics.guardConflicts).toEqual([declaring]);
        expect(solver.recoverySuggestions()).toMatchObject({
            conflicts: [first, second],
            conflictsEntangled: false,
        });
    });
});
