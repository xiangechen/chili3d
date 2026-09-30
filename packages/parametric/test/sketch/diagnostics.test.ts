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
