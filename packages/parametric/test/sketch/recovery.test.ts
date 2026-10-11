// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { ConstraintKind, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

/** The two endpoints of `line`, in the order every point-indexed constraint wants them. */
function ends(line: number): SketchPointRef[] {
    return [
        { entityId: line, pointIndex: 0 },
        { entityId: line, pointIndex: 1 },
    ];
}

describe("SketchSolver.recoverySuggestions", () => {
    test("a contradicting datum pair: both sides are single-deletion fixes", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 8, 0);
        const refs = ends(line);
        const first = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 10 });
        const second = solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 12 });

        expect(solver.solve(true).result).toContain("Conflict");
        const suggestions = solver.recoverySuggestions();

        // Deleting EITHER one leaves the other standing: the sketch is consistent again.
        expect(suggestions.conflicts).toEqual([first, second]);
        expect(suggestions.redundancies).toEqual([]);
        expect(suggestions.conflictsEntangled).toBe(false);
        expect(suggestions.redundanciesEntangled).toBe(false);
        expect(suggestions.truncated).toBe(false);
    });

    test("a duplicating constraint pair: either one may go", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        const refs = ends(line);
        const original = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        const duplicate = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });

        solver.solve(true);
        const suggestions = solver.recoverySuggestions();

        // This is where the group list and the deletion answer agree: the redundant
        // group's sources name exactly the pair (see the divergence test below for the
        // cases where they do not).
        expect(solver.diagnose().redundant).toEqual([original, duplicate]);
        expect(suggestions.redundancies).toEqual([original, duplicate]);
        expect(suggestions.conflicts).toEqual([]);
        expect(suggestions.redundanciesEntangled).toBe(false);
    });

    test("the group list over-reports: flagged is not the same as fixable", () => {
        // The rank heuristic and the deletion answer genuinely differ, and this is the
        // shape that shows it (the same divergence is measured in garlic's
        // `tests/diagnose_vs_removal.rs`): p0 pinned at the origin, its two offsets
        // pinned as distances, p1 pinned at the point those already determine. garlic
        // derives the second Fix's row from all three, so the redundant GROUP (a union
        // — "who derives it") names every constraint; the deletion answer names only
        // the two the sketch actually recovers from.
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 3, 4);
        const refs = ends(line);
        const q = solver.addConstraint({
            kind: ConstraintKind.Fix,
            refs: [refs[0]],
            datums: [0, 0],
        });
        const horizontal = solver.addConstraint({
            kind: ConstraintKind.HorizontalDistance,
            refs,
            datum: 3,
        });
        const vertical = solver.addConstraint({
            kind: ConstraintKind.VerticalDistance,
            refs,
            datum: 4,
        });
        const p = solver.addConstraint({
            kind: ConstraintKind.Fix,
            refs: [refs[1]],
            datums: [3, 4],
        });

        expect(solver.solve(true).result).toContain("Ok");
        expect(solver.diagnose().redundant).toEqual([q, horizontal, vertical, p]);

        // ...and dropping either distance does NOT clear it: only these two do.
        expect(solver.recoverySuggestions().redundancies).toEqual([q, p]);
    });

    test("a healthy sketch suggests nothing and claims nothing", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 10, 0);
        solver.addConstraint({ kind: ConstraintKind.Horizontal, refs: ends(line) });

        solver.solve(true);
        const suggestions = solver.recoverySuggestions();

        expect(suggestions.conflicts).toEqual([]);
        expect(suggestions.redundancies).toEqual([]);
        expect(suggestions.conflictsEntangled).toBe(false);
        expect(suggestions.redundanciesEntangled).toBe(false);
        expect(suggestions.truncated).toBe(false);
    });

    test("entangled conflicts report no single fix instead of naming a scapegoat", () => {
        // Both endpoints pinned, plus a distance/horizontal/vertical triple that cannot
        // hold together (√(1.13² + 5.11²) ≈ 5.23, not 4.81). Dropping one pin hands its
        // dependency to the others, so no single deletion clears the conflict — the
        // honest answer is "remove a combination", not a list of candidates.
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(-1.36, 2.38, 2.3, -0.61);
        const refs = ends(line);
        solver.addConstraint({ kind: ConstraintKind.Fix, refs: [refs[0]], datums: [-0.87, -4.75] });
        solver.addConstraint({ kind: ConstraintKind.Fix, refs: [refs[1]], datums: [2.3, -0.61] });
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 4.81 });
        solver.addConstraint({ kind: ConstraintKind.HorizontalDistance, refs, datum: 1.13 });
        solver.addConstraint({ kind: ConstraintKind.VerticalDistance, refs, datum: 5.11 });

        solver.solve(true);
        const diagnostics = solver.diagnose();
        expect(diagnostics.conflicting.length).toBeGreaterThan(0);

        const suggestions = solver.recoverySuggestions();
        expect(suggestions.conflicts).toEqual([]);
        expect(suggestions.conflictsEntangled).toBe(true);
        expect(suggestions.truncated).toBe(false);
    });

    test("a spent budget reports truncation and withholds the tangled verdict", () => {
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 8, 0);
        const refs = ends(line);
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 10 });
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 12 });

        solver.solve(true);
        const suggestions = solver.recoverySuggestions(0);

        expect(suggestions.truncated).toBe(true);
        expect(suggestions.conflicts).toEqual([]);
        // Nothing was tried, so "nothing helps" would be a lie about the sketch.
        expect(suggestions.conflictsEntangled).toBe(false);
    });

    test("the query leaves the sketch and its diagnostics where they were", () => {
        // Trial deletion tears the constraint table down and rebuilds it. It is meant to
        // be invisible from outside — the panel asks its question and the sketch carries
        // on — so the state after must be the state before, not merely a plausible one.
        const solver = new SketchSolver(Plane.XY);
        const line = solver.addLine(0, 0, 8, 0);
        const refs = ends(line);
        solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 10 });
        solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 12 });

        expect(solver.solve(true).result).toContain("Conflict");
        const entities = solver.entities();
        const before = solver.diagnose();

        solver.recoverySuggestions();

        expect(solver.entities()).toEqual(entities);
        expect(solver.diagnose()).toEqual(before);
        expect(solver.solve(true).result).toContain("Conflict");
    });
});
